---
layout: default
title: frogred8's blog
description: "공부한 내용을 만연체로 정리하는 블로그"
nav_exclude: true
permalink: /
---

공부한 내용을 만연체로 정리하는 블로그
<ul>
{% for page in site.pages %}
  {% if page.nav_exclude != true and page.name contains ".md" %}
  <li><a href="{{ page.url }}">{{ page.title }}</a></li>
  {% endif %}
{% endfor %}
</ul>