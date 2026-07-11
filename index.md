---
layout: default
title: frogred8's blog
description: "공부한 내용을 만연체로 정리하는 블로그"
nav_exclude: true
permalink: /
---

<p data-home-description="ko">공부한 내용을 만연체로 정리하는 블로그</p>
<p data-home-description="en" hidden>A blog that writes up what I study in a long-form style.</p>

<ul data-doc-list="ko">
{% assign korean_pages = site.pages | where_exp: "item", "item.url contains '/docs/'" | sort: "path" %}
{% for doc in korean_pages %}
  {% if doc.nav_exclude != true and doc.name contains ".md" %}
  <li><a href="{{ doc.url | relative_url }}">{{ doc.title }}</a></li>
  {% endif %}
{% endfor %}
</ul>

<ul data-doc-list="en" hidden>
{% assign english_pages = site.pages | where_exp: "item", "item.url contains '/docs_en/'" | sort: "path" %}
{% for doc in english_pages %}
  {% if doc.nav_exclude != true and doc.name contains ".md" %}
  <li><a href="{{ doc.url | relative_url }}">{{ doc.title }}</a></li>
  {% endif %}
{% endfor %}
</ul>

<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5261314982859092"
     crossorigin="anonymous"></script>

<hr>
