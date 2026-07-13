---
layout: page
title: "[mongodb] An analysis of covered query implementation"
date: 2023-05-20
---

<pre>
MongoDB, probably the most famous NoSQL database, has a feature called a covered query. I was curious about how it was implemented, so I analyzed the actual code. If not at a time like this, when else would I get to look through database code?


- Overview
First, for anyone who does not know what a covered query is, it refers to a command where all the values needed to satisfy the query are included in an index. Other databases also call this kind of index a covering index (Couchbase, MySQL, and so on). In any case, the terminology is a little different, but the implementation idea is the same.

Using MongoDB as an example, suppose the following document has been inserted into the user collection.
{_id: 54344, name:'a', age:10}

When an index has been created as {_id:1}, calling it like this becomes a covered query.

db.users.find({_id: 54344}, {_id:1});

As above, only when the query and projection fields can be fetched from the same index can the query be executed using only the information in the index, without scanning the data. Naturally, since the actual document does not need to be fetched, this has the advantage of faster responses.

However, there is one detail in MongoDB that is easy to miss: the _id field is always included even if you do not explicitly specify it in the projection.
For example, after setting the index to {age:1}, you might expect the query below to become a covered query, but that projection does not return only age. It also automatically includes _id.

db.users.find({age:15}, {age:1});
// result: {_id: 54344, age: 10}

So for the covered query to work properly, you need to do it like this.

db.users.find({age:10}, {age:1, _id:0});
// result: {age: 10}

You can see this more clearly by looking at the query plan for this query.

executionStats: {
  totalKeysExamined: 1,
  totalDocsExamined: 0,
  executionStages: {
    stage: 'PROJECTION_COVERED',
    inputStage: {
      stage: 'IXSCAN',
      ...

The totalDocsExamined value there is the number of times the actual document is fetched, and it is set to 0. The stage is also correctly set to COVERED. If you run explain on the incorrect query from earlier, you can confirm that totalDocExamined comes out as 1 like this.

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

Query and sorting optimization based on indexes can be tuned by adding hints depending on the data range or state. If anyone is interested, I may write about that sometime later.


- Analysis
Now I am going to download and look through the MongoDB code. When downloading a large open source project like this, it is a good idea to use git clone --depth 1 so that you only fetch the most recent level of history. Including the full history makes it several times larger for no real reason. (I barely look at the history anyway..)

First, while browsing through the directory structure, I found a file that looked closest to what I wanted: find_cmd.cpp. It contains a FindCmd class, which is a final class that inherits from Command.

class FindCmd final : public Command {
public:
  FindCmd() : Command("find") {}
  ...

And inside that class there is an inner class called Invocation, where the actual logic is implemented.

class Invocation final : public CommandInvocation {
public:
  Invocation(const FindCmd* definition, ...);
private:
  void explain(...);
  void run(...);

The run function there is the main function, but the code is quite long and most of it consists of calls to external functions, so it was really hard to analyze. In particular, I thought the place where the CanonicalQuery object (roughly, a "canonical query"?) was created was the main part, so I analyzed that path first, but in the end it was not. I almost gave up halfway through..

Anyway, the getExecutorFind function, located around the middle of this logic, was where it checked the covered query conditions I was looking for. Now let us get into the code I actually cared about.

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

Here, it determines the query engine for the CanonicalQuery object created earlier. MongoDB added transaction support in 4.0, and with Slot-Based Execution (SBE), introduced in version 4.4, it added functionality so that transactions could also work on sharded databases.

Of course, SBE is said to be superior to the classic query engine in every way, including performance and scalability. But the newer the technology, the more complex the internal logic tends to be, so here I will just look at the classic version, the getClassicExecutor function.

StatusWith&lt;std::unique_ptr&lt;PlanExecutor, PlanExecutor::Deleter>> getClassicExecutor(...) {
  ...
  ClassicPrepareExecutionHelper helper{opCtx, collection, ws.get(), canonicalQuery.get(), nullptr, plannerParams};
  auto executionResult = helper.prepare();

In this function, it creates a helper object and calls the prepare function,

StatusWith&lt;std::unique_ptr&lt;ResultType>> prepare() {
  ...
  auto statusWithMultiPlanSolns = QueryPlanner::plan(*_cq, _plannerParams);

and prepare finally calls the destination point, QueryPlanner::plan. This function is also about 600 lines long, so I will split it into two parts.

StatusWith&lt;std::vector&lt;std::unique_ptr&lt;QuerySolution>>> QueryPlanner::plan(const CanonicalQuery& query, const QueryPlannerParams& params) {
  ...
  std::vector&lt;IndexEntry> fullIndexList;
  stdx::unordered_set&lt;string> fields;
  QueryPlannerIXSelect::getFields(query.root(), &fields);
  fullIndexList = QueryPlannerIXSelect::expandIndexes(fields, std::move(fullIndexList));
  std::vector&lt;IndexEntry> relevantIndices;
  relevantIndices = QueryPlannerIXSelect::findRelevantIndices(fields, fullIndexList);

Up to here, this is the functionality that fetches the list of indexes. It gets indexes based on hints and retrieves the list of related indexes using the fields included in the query. 

  std::unique_ptr&lt;QuerySolutionNode> solnRoot(QueryPlannerAccess::buildIndexedDataAccess(query, std::move(nextTaggedTree), relevantIndices, params));
  auto soln = QueryPlannerAnalysis::analyzeDataAccess(query, params, std::move(solnRoot));
  return singleSolution(std::move(soln));
}

It creates a QuerySolutionNode object while passing in the related indexes, then runs the analyzeDataAccess function. Now we are almost there.

std::unique_ptr&lt;QuerySolution> QueryPlannerAnalysis::analyzeDataAccess(const CanonicalQuery& query, const QueryPlannerParams& params, std::unique_ptr&lt;QuerySolutionNode> solnRoot) {
  ...
  if (query.getProj()) {
    solnRoot = analyzeProjection(query, std::move(solnRoot), hasSortStage);

Looking at the analyzeProjection function called here,

std::unique_ptr&lt;QuerySolutionNode> analyzeProjection(const CanonicalQuery& query, std::unique_ptr&lt;QuerySolutionNode> solnRoot, const bool hasSortStage) {
  const auto& projection = *query.getProj();
  if (projection.isSimple() && projection.isInclusionOnly()) {
    auto coveredKeyObj = produceCoveredKeyObj(solnRoot.get());
    return std::make_unique&lt;ProjectionNodeCovered>(stage, *query.root(),projection, std::move(coveredKeyObj));
  }

we have finally arrived at the place where the covered query is created. Looking here, it checks whether the projection can be handled using only internal members, and then passes along a ProjectionNodeCovered class object. 

The query object created this way is passed back up through the call stack we followed earlier. When the object goes to the stage builder, it branches as shown below and creates the real implementation object, ProjectionStageCovered.

std::unique_ptr&lt;PlanStage> ClassicStageBuilder::build(const QuerySolutionNode* root) {
  switch (root->getType()) {
    case STAGE_PROJECTION_COVERED: {
      auto pn = static_cast&lt;const ProjectionNodeCovered*>(root);
      auto childStage = build(pn->children[0].get());
      return std::make_unique&lt;ProjectionStageCovered>(...);

The implementation of that object is fairly simple.

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

I did not include that code here, but in the constructor, it adds only the fields found in the already-filtered _includeKey array and passes along a BSON object. With that, the long journey of covered query execution comes to an end. I did not explain it separately, but along the way there were also small interesting things like the index plan cache policy.


- Conclusion
1) In MongoDB, when a query is covered, it can fetch values using only an index scan, so it is very fast.
2) Looking at the code, it checks the conditions when creating the query and creates a ProjectionNodeCovered object.
3) The object created this way is executed in the stage builder, and the journey ends there.

Previous post: https://frogred8.github.io/
#frogred8 #mongodb #covered_query