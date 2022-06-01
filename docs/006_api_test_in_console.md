---
layout: default
title: "[etc] console에서 API 테스트 방법 (nc, telnet, curl, httpie)"
---

## [etc] console에서 API 테스트 방법 (nc, telnet, curl, httpie)

<pre>
이번엔 웹 서버를 열어놓고 간단히 api 테스트를 하는 방법에 대해 하나씩 알아볼거야. 내 컴퓨터에서 익숙한 라이브러리를 사용해서 테스트할 수도 있지만 서버에 직접 들어가서 할 때도 있으니까 기본 방법부터 같이 보자. 여기선 3000번 포트에 {msg:'hello'} 반환하는 간단한 js서버를 띄워놨어.

1) nc (netcat)
넷캣이 가장 기본 라이브러리라서 먼저 소개할게. 얘는 ip, port로 접근해서 할 수 있는걸 대부분 할 수 있어. port listen, scan 등등.. 기능을 잠깐 살펴보면

nc -l localhost 3001 (3001포트 listening)
nc localhost 3001 (3001포트 접속)

저렇게 포트 하나 열어두고 다른 쉘에서 접속하면 telnet처럼 커서만 깜박이는데 거기에 메시지를 전송할 수 있어. 그리고 다른 유용한 기능은 포트 스캔이야. 저렇게 range 범위로도 할 수 있어.

nc -zvv localhost 2998-3002

localhost [127.0.0.1] 2998 (realsecure): Connection refused
localhost [127.0.0.1] 2999 (remoteware-un): Connection refused
localhost [127.0.0.1] 3000 (hbci) open
localhost [127.0.0.1] 3001 (redwood-broker): Connection refused
localhost [127.0.0.1] 3002 (exlm-agent): Connection refused

-z는 접속 유무만 확인할 때 쓰고, -v는 출력 결과를 자세히 보는 옵션이야. (vv는 더 자세히 보는거고) 
참고로 3000번 포트 옆에 hbci라고 나오는 건 IANA에 기록된 저 포트가 사용하고 있는 어플이니 참고만 하고.
https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml

어쨌든 우린 웹서버에 접속 테스트를 하는 거니까 접속해보면 커서만 깜박일거야. 거기에 GET / 엔터 두번 때리면 이렇게 나와. (HTTP rfc 문서를 보면 인터페이스 규약에 저렇게 되어있는거 알지?)

root@4b9330a3e502:/# nc 192.168.0.6 3000
GET /

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 15
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Date: Wed, 18 May 2022 00:21:53 GMT
Connection: close

{"msg":"hello"}

근데 접속할 때마다 매번 손아프게 치기가 귀찮잖아? 그러니 echo랑 파이프를 써서 자동화 할 수 있어.

root@4b9330a3e502:/# echo -e "GET /\r\n\r\n" | nc 192.168.0.6 3000
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
...


2) telnet
텔넷도 좀 비슷한데 이건 내부 쉘에서 접속도 가능해. 일단 telnet으로 접속하게 되면 nc랑 똑같이 GET / 를 입력할 수 있어.

root@4b9330a3e502:/# telnet 192.168.0.6 3000
Trying 192.168.0.6...
Connected to 192.168.0.6.
Escape character is '^]'.
GET /

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 15
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Date: Wed, 18 May 2022 00:25:47 GMT
Connection: close

{"msg":"hello"}Connection closed by foreign host.

다만 기본이 HTTP/1.0이기 때문에 connection이 일회성으로 되어있어. 이걸 HTTP/1.1로 보내주면 keep-alive로 바뀌게 되는데 기본값이 5초라 다음 명령을 치기엔 좀 짧아서 금방 꺼져버리네. 

root@4b9330a3e502:/# telnet 192.168.0.6 3000
Trying 192.168.0.6...
Connected to 192.168.0.6.
Escape character is '^]'.
GET / HTTP/1.1

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 15
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Date: Wed, 18 May 2022 00:31:04 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"msg":"hello"}Connection closed by foreign host.

telnet 도중에 ^]로 나가게 되면 telnet command line으로 나가게 되는데 거기서 다시 웹페이지 접속이나 이것저것 할 수 있지만 그런거 사용안할거니 그냥 나가면 돼. (^c or quit)

근데 이거 하면서 새롭게 알게 된 것도 있었어. keep-alive가 클라쪽 스펙인줄 알았는데 서버쪽이었더라고. 사실 조금만 깊이 생각해보면 당연한건데.. 어쨌든 keep-alive는 이렇게 설정이 가능해. (여기서는 js, express)

const express = require('express');
const app = express();
const port = 3000;
const server = app.listen(port);
server.keepAliveTimeout = 60 * 1000;


이제 POST를 보내보자.

root@4b9330a3e502:/# telnet 192.168.167.76 3000
Trying 192.168.167.76...
Connected to 192.168.167.76.
Escape character is '^]'.
POST /accounts
Content-Type: application/json
Content-length: 24

{"name":"pupu","age":11}
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 26
ETag: W/"1a-jJ7tWy+vDtgdXAlx0uVXP3y0y4g"
Date: Sun, 22 May 2022 12:55:22 GMT
Connection: close

"added (pupu/11)"

POST는 조금 까다로운데 일단 content-type 헤더에 json을 붙여주고, content-length를 지정해줘야 해. length 지정을 하지 않으면 엔터 두번 치는 순간 전송되버림. 근데 length를 실제 body보다 짧게 하면 서버에서 파싱이 에러나고, 길게 하면 그만큼 입력해주지 않으면 전송이 안되니까 글자수를 정확히 세야하는게 좀 귀찮긴 하더라고. 사용법은 nc도 동일해서 다시 적진 않을게.


3) curl

하지만 nc, telnet은 너무 원시적이지? 매번 치는 것도 힘들고 length 세는건 더 귀찮고. 그래서 보통 많이 쓰는 curl을 볼건데 GET /, POST /accounts 를 같이 볼게

root@4b9330a3e502:/# curl 192.168.167.76:3000
{"msg":"hello"}

root@4b9330a3e502:/# curl 192.168.167.76:3000/accounts -X POST -H "Content-Type: application/json" -d '{"name":"pupu","age":22}'
"added (pupu/22)"

자주 쓰는 옵션을 주로 살펴보면 GET은 그냥 브라우저처럼 치면 알아서 응답을 받아오는데 POST는 -X 옵션으로 메소드를 지정해줘야 해. PUT이면 -X PUT이 되겠지. 그리고 헤더는 -H "~~" 로 추가하고 -d 로 body를 채워넣으면 되고. 여기서는 length 설정 안해줘도 되니 개꿀.

4) httpie

이건 기본 명령어는 아니고 따로 설치하면 되는데 난 로컬 터미널에선 이걸 주로 쓰고 있어. 이것도 GET, POST 같이 볼게.

root@4b9330a3e502:/# http 192.168.167.76:3000
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 15
Content-Type: application/json; charset=utf-8
Date: Sun, 22 May 2022 13:18:49 GMT
ETag: W/"f-E5da4I0TjHtY8KZGKhpci1Ikro4"
Keep-Alive: timeout=60
X-Powered-By: Express

{
    "msg": "hello"
}

root@4b9330a3e502:/# http 192.168.167.76:3000/accounts name=pupu age=33
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 17
Content-Type: application/json; charset=utf-8
Date: Sun, 22 May 2022 13:19:04 GMT
ETag: W/"11-QHZiqu8kcX+/YIBoCd9o5mMlTUk"
Keep-Alive: timeout=60
X-Powered-By: Express

"added (pupu/33)"

여기서는 post 설정이 따로 없어도 요청 뒤에 저렇게 변수를 추가해주면 알아서 json으로 보내니 편하더라고. 만약 json 형식으로 보내고 싶으면 --raw 옵션으로 curl처럼 보내면 돼. 그리고 응답받은 내용은 컬러링된 내용이라 보기도 편해.


보통 커맨드 라인으로는 핑체크 정도긴 한데 가끔 터미널에서 post 보내고 싶을 때가 있어서 쭉 정리해봤어. nc -l 기능으로 해당 서버의 acl 확인을 미리 해볼 수 있는 것도 가끔 쓰고..

작업할 때는 보통 postman을 써서 테스트를 하는데 자동화 기능이 꽤 좋아. 로그인, 계정 생성, 데이터 입력 등 요청을 컬렉션 하나로 묶어서 스크립트 조금 추가해주면 클릭 한 번에 로그인 토큰 저장해서 기본 세팅을 해놓고 원하는 요청을 날릴 수 있어. 이건 postman 사이트나 여기저기 있으니 찾아봐. 왠만한건 이걸로 테스트 자동화도 가능할걸?


결론)
1) nc는 생각보다 기능이 많다
2) httpie 짱짱
3) postman 자동화에 대한 공부 추천


이번 주는 여행다녀오느라 좀 바빴네. 공주산성이 생각보다 크고 높더라. 다음 날에 다리가 후들후들.
얼마 남지 않았지만 주말 즐겁게 보내!

#javascript #api_test #httpie