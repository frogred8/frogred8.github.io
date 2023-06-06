---
layout: page
title: "[network] 애플은 몇 개의 IP를 사용할까?"
date: 2023-06-07
---

<pre>
어제 애플 발표를 보면서 저런 글로벌 기업은 IP를 몇 개나 할당받아서 사용하고 있을지 궁금해져서 이것저것 찾아보다가 재미있는 내용이 많아서 간단히 정리해봤어. 가볍게 읽어줘.


- 개요
자세히 들어가기전에 다 아는 얘기 잠깐 한번 해보면, 
IP 발급은 최초에 IANA(Internet Assigned Numbers Authority, 인터넷 할당 번호 관리기관)라는 조직체에서 운영했어. 그러다가 점점 커져서 ICANN(Internet Corporation for Assigned Names and Numbers, 국제도메인관리기구)으로 이관되고, 여기서 다시 RIR(Regional Internet Registry, 지역 인터넷 등록기관)마다 분리되어 아프리카, 아시아, 북미, 남미, 유럽 이렇게 총 5개가 운영 중이야.
https://www.arin.net/about/welcome/region/

그래서 각 RIR마다 할당된 IP 개수를 세보면 이렇게 돼. 아무래도 미국에 초대기업이 다 있다보니 북미RIR인 ARIN에서 16.6억개나 가지고 있네.

AFRINIC(아프리카)	115,739,648	(2.7%)
APNIC(아시아)	887,005,696	(20.7%)
ARIN(북미)	1,662,226,432	(38.7%)
LACNIC(남미)	189,931,520	(4.4%)
RIPENCC(유럽)	831,209,096	(19.4%)

그리고 CIDR(Classless Inter-Domain Routing) 표기법도 설명을 빼놓을 수 없는데 예전엔 IP Class라고 해서 A~E Class로 구분되던 방식을 비트단위로 범위 지정을 할 수 있는 표기법이야. 개념은 쉬워서 예제만 봐도 알 수 있을거야.

1.0.0.0 ~ 1.255.255.255 -> (1.0.0.0/8)
1.30.0.0 ~ 1.30.255.255 -> (1.30.0.0/16)
1.30.128.0 ~ 1.30.255.255 -> (1.30.128.0/17)
1.30.238.0 ~ 1.30.238.255 -> (1.30.238.0/24)
1.30.238.32 ~ 1.30.238.35 -> (1.30.238.32/30)


- 내용
일단 애플 IP 관련 기사를 보면 17.0.0.0/8을 가지고 있다고 나와있어서 이를 기준으로 검색해보니 /8 block 위키 페이지가 따로 있더라. (아래부터는 편의상 0인 하위 주소는 생략한 cidr로 표기할게)
https://en.wikipedia.org/wiki/List_of_assigned_/8_IPv4_address_blocks

at&t는 12/8, 애플은 17/8, 그 외에 포드, 푸르덴셜, 벤츠, 컴캐스트 등의 개인 기업들이 예전에 A클래스라고 불리던 /8 block을 가지고 있어. 참고로 /8 block 하나의 IP 개수는 2^24=1677만개나 돼. 일부 기업은 나중에 쪼개서 팔기도 했어. (후술)

그런데 이런 /8 block을 14개나 소유하고 있는 주체가 미국방부라는거 알아? 사실 최초 인터넷 개발 목적 자체가 미국이 냉전 시대에 핵전쟁으로 발생할 중앙 서버 마비에 대한 보완책이었고, 이를 위해서 분산된 망을 구성했는데 그게 인터넷의 시초인 ARPAnet이야.

저 위키에 정리된걸 보면 DOD(United States Department of Defense, 미국방부) 소유로 A클래스 14개를 점유하고 있고, 이걸 계산해보면 DOD가 가진 하위 IP의 수가 무려 2억 3천만개나 돼. IPv4가 이론상 42억개를 가질 수 있으니까 전체 IP의 5%이고, 미리 예약된 IP 대역들(0/8, 10/8, 127/8, 240/4 등등)을 제외하면 현실적인 비율은 더 크겠지.

우연히 재미있는 자료가 있길래 잠깐 얘기해봤고 다시 본론으로 돌아가서,
ARIN(American Registry for Internet Numbers) 사이트에서 IP를 검색하면 해당 IP 대역을 소유한 회사를 알 수 있는데 17.0.0.0으로 검색하면 APPLE-WWNET 이름으로 등록된 걸 확인할 수 있어.
https://search.arin.net/rdap/?query=17.0.0.0

저 링크에서 회사 기준으로 애플에서 소유한 모든 아이피를 확인하는 아래 링크로 갈 수 있는데 여기서 등록된 대역은 3개인데 (1677만 1개, 256짜리 2개) 이를 통해 애플은 ARIN에서 약 1677만개의 아이피를 소유한 걸 알 수 있어.
https://whois.arin.net/rest/org/APPLEC-1-Z/nets

그런데 이런 다국적 기업은 ARIN 외에 유럽이나 아시아에도 소유한 IP 대역이 있을거잖아? 그걸 하나씩 다 추적하자니 많이 귀찮아져서 더 검색해보니까 전세계 기준으로 회사 소유 IP 대역을 알아오는 사이트도 있더라고.
https://networksdb.io/ip-addresses-of/apple-inc

애플은 376개의 IPv4 대역을 가지고 있고 사이트에서는 100개만 보여주는데 영국, 독일 등 여러 국가에 등록된 아이피 대역도 다 보여서 좋았어. 다만 전체 목록을 보려면 돈을 내야하는데 다행히 network size 순으로 정렬되어 있어서 내가 원하는 대략적인 정보는 얻어올 수 있었어. 어차피 100개 이후의 대역들은 소규모 블럭이라 대세에 영향은 없다고 생각해.

그렇게 웹페이지를 긁어다가 이케저케해서 더해보면 최종적으로 애플이 소유한 아이피는 1683만개인걸 알 수 있었어. 쉽게 계산이 가능하다보니 다른 대기업들도 궁금해져서 동일한 방법으로 정리해봤어.

Apple: 1683만개
Google: 1941만개
Amazon: 6500만개
Microsoft: 5830만개
Comcast: 8290만개
Verizon: 8001만개

[국내]
SKT : 871만개
KT : 4717만개
LG : 750만개


그런데 Amazon은 자신이 사용 중인 모든 대역을 ip-range.json 파일로 서빙하더라고? 크로스 체크도 해볼겸 그 파일을 열었더니 이런 식으로 구성되어 있었는데 IP 대역이 7300개가 넘는 큰 파일이었어.
https://ip-ranges.amazonaws.com/ip-ranges.json

{
  "syncToken": "1686021789",
  "createDate": "2023-06-06-03-23-09",
  "prefixes": [
    {
      "ip_prefix": "3.2.34.0/26",
      "region": "af-south-1",
      "service": "AMAZON",
      "network_border_group": "af-south-1"
    },
    ...

어쨌든 이 정보를 cidr 기준으로 더해보니까 1억 3500만개가 나오는거야. 왜 이렇게 오차가 크지? 싶어서 다시 그 검색 사이트를 가봤더니 내가 검색한 건 Amazon, Inc였는데 실제로는 Amazon Data Service도 있고, Amazon EU도 있고 등등.. Amazon의 국가별 법인이나 기타 사업상 필요로 인해 나눠서 등록한 IP는 추적하지 못한거였어. 

그러니 여기서 정리한 내용은 그냥 재미삼아보고 혹시 공식 자료로 쓰려면 기타 법인들이 등록한 것까지 다 포함해서 가져와야 할거야. (아니면 아마존처럼 친절하게 알려주는 ip range api를 찾아보던가..)


- 가격
개수를 취합하다보니 이런저런 기사도 같이 읽게 되었는데 IP가 생각보다 비싸더라고. 
기사가 많지는 않은데 큼직한 거래 내역만 정리해보면 이래.

2011년: 캐나다 통신업체 Nortel이 파산하면서 Microsoft로 IP 대역 66만개를 750만달러, 즉 IP당 11.25달러에 팜.
2017년: MIT가 AWS에 800만개 팜. (거래 가격은 알려지지 않았지만 시기 추산으로 IP당 13달러)
2018년: General Electronic이 /8 block, 1677만개를 AWS에 팜. (시기 추산 IP당 15달러)
2019년: Amateur Radio Digital Communications (ARDC)가 /10 block, 419만개를 AWS에 108만달러에 팜. IP당 25.74달러

현재 개당 IP 가격은 APNIC(아시아) 기준으로 40~55달러 사이인데 다른 지역은 별다른 정보가 없네. 가격 그래프는 가장 아래에 넣어놨고, 원본 링크는 여기야.
https://blog.apnic.net/2023/01/23/ip-addressing-through-2022/


이제 마무리하려고 정리하다보니 이 거래들에 대한 low data는 어디있는지 궁금해서 이걸 또 찾아봤는데 각 RIR들에서 json으로 관리하고 있었어. 연단위 폴더 안에 들어가면 일단위로 된 json이 있는데 사실 2012년부터 계속 append된 데이터라 최근 항목을 보면 크롬이 다운될 정도로 용량이 크니까 조심해.
https://ftp.arin.net/pub/stats/arin/transfers/

저 안에 데이터는 이런 식으로 생겼는데 Merck(제약사)도 IP를 판 기록이 있길래 신기해서 가져와봤어.
{
  "type" : "RESOURCE_TRANSFER",
  "ip4nets" : {
    "original_set" : [ {
      "start_address" : "054.000.000.000",
      "end_address" : "054.255.255.255"
    } ],
    "transfer_set" : [ {
      "start_address" : "054.224.000.000",
      "end_address" : "054.239.255.255"
    } ]
  },
  "source_organization" : {
    "name" : "Merck and Co., Inc.",
    "country_code" : "US"
  },
  "recipient_organization" : {
    "name" : "Amazon Technologies Inc.",
    "country_code" : "US"
  },
  "transfer_date" : "2012-03-01T18:48:00Z",
  "source_registration_date" : "1992-03-17T05:00:00Z",
  "source_rir" : "ARIN",
  "recipient_rir" : "ARIN"
},

Merck는 기존에 54/8 대역을 통으로 가지고 있었는데 2012년 3월에 54.224/12 대역 (104만개) IP를 Amazon에 넘긴 내역을 확인할 수 있어. 다만 이건 발급 기관에서 관리를 위한 데이터라 가격이 없는게 조금 아쉽네.


- 결론
1) Apple은 1683만개의 IP를 사용한다.
2) 미국방부는 /8 block을 14개 가지고 있다. (2억 3천만개)
3) IP 대역을 20년 전에 발급받아 놨으면 꽤 큰 돈을 벌 수 있었다. (그 때는 회사가 IP 대역을 신청하면 '비교적 여유로운' 심사 후 할당되는 방식이었기 때문. 지금은 2차 시장에서 사는게 일반적)
4) 지금은 회사가 가진 IP 대역이 회사 자산에서 적지 않은 부분을 차지하고 있음.


이전글: https://frogred8.github.io/
#frogred8 #network #apple #ip