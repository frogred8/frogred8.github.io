---
layout: page
title: "[c++] 메모리 해제 시 사이즈를 적지 않아도 되는 이유"
---

## [c++] 메모리 해제 시 사이즈를 적지 않아도 되는 이유

<pre>

빠밤



std::string에서 짧은 문자열은 어떻게 생성되는가 (SSO)
https://blogs.msmvps.com/gdicanio/2016/11/17/the-small-string-optimization/


#define INTERNAL_SIZE_T size_t
#define SIZE_SZ (sizeof (INTERNAL_SIZE_T))
#define MAX_FAST_SIZE     (80 * SIZE_SZ / 4)

할당하는 메모리가 MAX_FAST_SIZE보다 작으면 이미 선점해놓은 메모리 대역을 사용

