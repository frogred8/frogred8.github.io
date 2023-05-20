---
layout: page
title: "[mongodb] covered query 구현 분석"
date: 2023-05-20
---

<pre>
nosql 중에 가장 유명한 mongodb에는 covered query 라고 부르는 기능이 있는데 어떤 식으로 구현되었는지 궁금해서 실제 코드를 분석해봤어. 이럴 때 아니면 언제 db 코드를 구경해보겠어?


- 개요
일단 covered query가 뭔지 모르는 분들을 위해 설명하면, 쿼리를 충족하는 값이 모두 인덱스에 포함된 명령을 말해. 다른 db에서는 이 인덱스를 covering index 라고도 부르는데 (Couchbase, mysql 등) 어쨌든 용어는 조금 다르지만 구현 아이디어는 동일해.

mongodb를 예로 들면, user 컬렉션에 아래 문서가 입력되어 있다고 해봐.
{_id: 54344, name:'a', age:10}

인덱스가 {_id:1} 로 생성되어 있을 때, 이렇게 부르면 covered query가 돼.

db.users.find({_id: 54344}, {_id:1});

이처럼 쿼리와 프로젝션 항목이 동일한 인덱스에서 가져올 수 있는 정보일 때에 한해서 데이터 탐색을 하지 않고 인덱스에 있는 정보만으로 쿼리가 실행될 수 있어. 당연히 실제 문서를 가져오지 않아도 되니 응답이 빨라지는 장점이 있어.

다만 mongodb에서는 놓치기 쉬운 부분이 있는데 _id 필드는 프로젝션에 별도로 지정하지 않아도 항상 포함하도록 되어있다는 점이야.
예를 들어 인덱스를 {age:1} 으로 해놓고 나서 아래같은 쿼리로 covered query가 되길 기대하는데 저 프로젝션은 age만 반환하는게 아니라 _id도 자동으로 포함하게 되어있어.

db.users.find({age:15}, {age:1});
// result: {_id: 54344, age: 10}

따라서 제대로 covered query가 작동하려면 아래처럼 해줘야 돼.

db.users.find({age:10}, {age:1, _id:0});
// result: {age: 10}

이 쿼리에 대해 query plan을 해보면 더 명확히 알 수 있어.

executionStats: {
  totalKeysExamined: 1,
  totalDocsExamined: 0,
  executionStages: {
    stage: 'PROJECTION_COVERED',
    inputStage: {
      stage: 'IXSCAN',
      ...

저기 totalDocsExamined 값이 실제 문서를 가져오는 횟수인데 0으로 되어있고, stage도 COVERED로 잘 설정되어 있어. 처음에 했던 잘못된 쿼리를 explain 해보면 이렇게 totalDocExamined 값이 1로 나오는걸 확인할 수 있어.

executionStats: {
  totalKeysExamined: 1,
  totalDocsExamined: 1,
  executionStages: {
    stage: 'PROJECTION_SIMPLE',
    inputStage: {
      stage: 'FETCH',
      docsExamined: 1,
      inputStage: {
        stage: 'IXSCAN',
        ...

인덱스에 따른 쿼리 및 소팅 최적화는 데이터의 범위나 상태에 따라 hint를 넣어줘서 튜닝이 가능한데 이건 관심있어하는 분들이 있으면 나중에 한번 써볼게.


- 분석
이제 mongodb 코드를 받아서 살펴볼거야. 이런 큰 오픈소스를 받을 때에는 git clone --depth 1 로 히스토리를 최근 한 단계만 가져오는게 좋아. 전체 히스토리를 포함하면 괜히 몇 배나 커지거든. (어차피 히스토리는 거의 안보니까..)

먼저 디렉토리 구조를 쭉 보다가 가장 가까워 보이는 find_cmd.cpp 파일을 찾았어. 여기엔 FindCmd 클래스가 있는데 Command를 상속받은 final class야.

class FindCmd final : public Command {
public:
  FindCmd() : Command("find") {}
  ...

그리고 저 클래스 안에 Invocation이라는 inner class가 하나 있는데 실제 로직은 여기에 구현되어 있어.

class Invocation final : public CommandInvocation {
public:
  Invocation(const FindCmd* definition, ...);
private:
  void explain(...);
  void run(...);

저기 run 함수가 메인 함수인데 코드가 꽤 긴데다가 대부분 외부 함수 호출로 되어있어서 분석하기가 참 힘들었어. 특히 CanonicalQuery(번역하면 정식 쿼리?) 객체를 만드는 곳이 메인인줄 알고 그쪽으로 분석해봤더니 끝내 아니어서 중간에 때려칠 뻔..

어쨌든 이 로직의 중간 쯤에 위치한 getExecutorFind 함수가 내가 찾던 covered query 조건을 검사하는 곳이었어. 이제 진짜 관심있는 코드로 들어가볼게.

StatusWith&lt;std::unique_ptr&lt;PlanExecutor, PlanExecutor::Deleter>> getExecutor(...) {
  ...
  if (!canonicalQuery->getForceClassicEngine() && canonicalQuery->isSbeCompatible()) {
    ...
    auto statusWithExecutor = attemptToGetSlotBasedExecutor(...);
    auto& maybeExecutor = statusWithExecutor.getValue();
    return std::move(maybeExecutor);
  }
  canonicalQuery->setSbeCompatible(false);
  return getClassicExecutor(opCtx, mainColl, std::move(canonicalQuery), yieldPolicy, plannerParams);
}

여기서 이전에 생성했던 CanonicalQuery 객체의 query engine을 판단하게 돼. mongodb는 4.0에 transaction 기능이 들어갔는데 4.4버전에 들어간 Slot-Based Execution(SBE)으로 샤딩된 db도 transaction이 가능하도록 기능이 추가됐어.

물론 sbe가 classic query engine보다 성능, 확장성 등 모든 면이 우위라고 하는데 신기술로 갈수록 내부 로직은 복잡해지기 마련이라서 여기서는 그냥 classic 버전인 getClassicExecutor 함수를 볼거야.

StatusWith&lt;std::unique_ptr&lt;PlanExecutor, PlanExecutor::Deleter>> getClassicExecutor(...) {
  ...
  ClassicPrepareExecutionHelper helper{opCtx, collection, ws.get(), canonicalQuery.get(), nullptr, plannerParams};
  auto executionResult = helper.prepare();

이 함수에서는 helper객체를 만들어서 prepare 함수를 호출하고,

StatusWith&lt;std::unique_ptr&lt;ResultType>> prepare() {
  ...
  auto statusWithMultiPlanSolns = QueryPlanner::plan(*_cq, _plannerParams);

prepare는 드디어 종착점인 QueryPlanner::plan 함수를 호출하게 돼. 이 함수도 600줄쯤 되는데 두 부분으로 나눠서 볼게

StatusWith&lt;std::vector&lt;std::unique_ptr&lt;QuerySolution>>> QueryPlanner::plan(const CanonicalQuery& query, const QueryPlannerParams& params) {
  ...
  std::vector&lt;IndexEntry> fullIndexList;
  stdx::unordered_set&lt;string> fields;
  QueryPlannerIXSelect::getFields(query.root(), &fields);
  fullIndexList = QueryPlannerIXSelect::expandIndexes(fields, std::move(fullIndexList));
  std::vector&lt;IndexEntry> relevantIndices;
  relevantIndices = QueryPlannerIXSelect::findRelevantIndices(fields, fullIndexList);

여기까지는 인덱스 목록을 가져오는 기능이야. hint 기준으로 인덱스를 가져오고 query에 포함된 field로 연관 인덱스 목록을 가져오고 있어. 

  std::unique_ptr&lt;QuerySolutionNode> solnRoot(QueryPlannerAccess::buildIndexedDataAccess(query, std::move(nextTaggedTree), relevantIndices, params));
  auto soln = QueryPlannerAnalysis::analyzeDataAccess(query, params, std::move(solnRoot));
  return singleSolution(std::move(soln));
}

QuerySolutionNode 객체를 생성하면서 연관 인덱스를 넘기고, analyzeDataAccess 함수를 실행하는데 이제 거의 다 왔어.

std::unique_ptr&lt;QuerySolution> QueryPlannerAnalysis::analyzeDataAccess(const CanonicalQuery& query, const QueryPlannerParams& params, std::unique_ptr&lt;QuerySolutionNode> solnRoot) {
  ...
  if (query.getProj()) {
    solnRoot = analyzeProjection(query, std::move(solnRoot), hasSortStage);

여기서 호출하는 analyzeProjection 함수를 보면,

std::unique_ptr&lt;QuerySolutionNode> analyzeProjection(const CanonicalQuery& query, std::unique_ptr&lt;QuerySolutionNode> solnRoot, const bool hasSortStage) {
  const auto& projection = *query.getProj();
  if (projection.isSimple() && projection.isInclusionOnly()) {
    auto coveredKeyObj = produceCoveredKeyObj(solnRoot.get());
    return std::make_unique&lt;ProjectionNodeCovered>(stage, *query.root(),projection, std::move(coveredKeyObj));
  }

드디어 covered query 생성하는 곳에 도착했어. 여기를 보면 projection이 내부 멤버만으로 가능한지 체크해서 ProjectionNodeCovered 클래스 객체를 전달하게 돼. 

이렇게 생성된 쿼리 객체는 여태까지 타고 왔던 저 위의 콜스택으로 전달되고, 객체가 stage builder로 가면 아래처럼 분기 처리하면서 진짜 구현체인 ProjectionStageCovered 객체를 생성해 주는거야.

std::unique_ptr&lt;PlanStage> ClassicStageBuilder::build(const QuerySolutionNode* root) {
  switch (root->getType()) {
    case STAGE_PROJECTION_COVERED: {
      auto pn = static_cast&lt;const ProjectionNodeCovered*>(root);
      auto childStage = build(pn->children[0].get());
      return std::make_unique&lt;ProjectionStageCovered>(...);

저 객체의 구현부를 보면 꽤 간단한 편이야.

void ProjectionStageCovered::transform(WorkingSetMember* member) const {
  BSONObjBuilder bob;
  BSONObjIterator keyIterator(member->keyData[0].keyData);
  while (keyIterator.more()) {
    BSONElement elt = keyIterator.next();
    if (_includeKey[keyIndex]) {
      bob.appendAs(elt, _keyFieldNames[keyIndex]);
    }
    ++keyIndex;
  }
  transitionMemberToOwnedObj(bob.obj(), member);
}

여기 코드는 안넣었는데 생성자에서 이미 필터링한 _includeKey 배열에서 찾은 필드만 추가해서 bson 오브젝트를 전달해주는걸로 covered query 실행의 대장정이 끝나게 돼. 따로 설명은 안했지만 코드 중간에 인덱스 플랜 캐시 정책이나 그런 것도 소소하게 재미있더라.


- 결론
1) mongodb는 covered query일 경우에 인덱스 스캔만으로도 값을 가져올 수 있어 매우 빠르다.
2) 코드를 보면, 쿼리 생성 시 조건을 확인하여 ProjectionNodeCovered 객체를 생성한다.
3) 이렇게 생성한 객체는 stage builder에서 실행되며 여정이 끝난다.

이전글: https://frogred8.github.io/
#frogred8 #mongodb #covered_query