# 软体物理 playground

[![原项目协议](https://img.shields.io/badge/原项目-MIT-4de2ff?style=flat-square)](https://github.com/erayzesen/QuarkPhysics/blob/master/LICENSE)
[![原项目 Star](https://img.shields.io/github/stars/erayzesen/QuarkPhysics?style=flat-square&logo=github&label=QuarkPhysics)](https://github.com/erayzesen/QuarkPhysics)
[![Astro](https://img.shields.io/badge/Astro-7-BC52EE?style=flat-square&logo=astro&logoColor=white)](https://astro.build)
[![部署](https://img.shields.io/badge/Cloudflare_Workers-已上线-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://quark.leolee0812.site)

在浏览器里戳一戳会像果冻一样弹半天的 2D 软体物理 playground。

线上地址：**<https://quark.leolee0812.site>**

## 这是什么

[QuarkPhysics](https://github.com/erayzesen/QuarkPhysics) 是 Eray Zesen 用 C++ 写的 2D 物理引擎（MIT，2023 年开源），
同时支持刚体和软体。它的 README 里那几个 GIF 效果很好，但要亲眼看到、要自己调参数，
**必须先装 SFML 2.x 和 CMake 把示例编译出来**，作者没有做网页版。

这个站把它公开的算法思路（mass-spring model、area-volume preserving、shape matching、PBD dynamics）
**用 JavaScript 重新实现了一遍**，做成一个点开就能玩的 playground：

- 四个预设场景：果冻广场 / 弹簧链 / 箱子堆叠 / 布袋娃娃
- 鼠标或手指可以**拖、甩、扔**，点空白处等于戳一炮
- 四个滑块实时调：刚度、阻尼、重力、压强
- 「线框」开关能看到它其实只是一堆质点和约束

> ⚠️ **这不是移植，也不是绑定**，是照着公开算法思路做的独立再实现，
> 精度和性能都不代表原引擎水平。要认真做游戏，请直接用原项目。

## 物理内核

全部在 `src/scripts/engine.js`，不到 500 行，没有任何物理库依赖：

| 模块 | 对应原项目 | 做的事 |
|---|---|---|
| Verlet 积分 | — | 速度由「当前位置 − 上一步位置」隐式表示 |
| 距离约束 | `qspring` / `qjoint` | 把两个质点拉回静止距离，刚度滑块调的就是它 |
| 面积约束 | `qareabody` | 轮廓面积拉回 静止面积 × 压强，果冻靠它不塌 |
| 形状匹配 | `qsoftbody` | 求最贴合静止形状的旋转，箱子靠它堆四层不倒 |
| 多边形推出 | `qcollision` | 质点掉进别人多边形里就沿最近边推出，带切向摩擦 |

完整讲解见站内的[算法笔记](https://quark.leolee0812.site/guide/)。

### 调这套参数踩过的坑

1. **质点圆碰撞半径不能大于物体生成间隙**：否则场景一加载就互相弹开，箱子金字塔当场炸成一排。
   现在两个有闭合轮廓的物体之间只走多边形推出，圆碰撞只留给绳链。
2. **摩擦只能每子步施加一次**：写在迭代循环里会一帧叠加 18 次，所有东西都被黏死，果冻停在斜坡上不滚。
3. **刚度要做迭代补偿**（`k' = 1 − (1−k)^(1/n)`）：不补偿的话滑块拉到 0.05 也硬得像 0.6，滑块等于白放。
4. **静态质点落进动态物体时不能直接 return**：否则薄斜坡会被软体直接穿过去。

## 本地开发

```bash
pnpm install
pnpm dev        # http://localhost:4321
pnpm build      # 产出 dist/
```

技术栈：Astro 7 + Starlight（只用于 `/guide/` 那一页），首页是单文件 Astro + 原生 Canvas 2D，零运行时框架。
部署在 Cloudflare Workers Static Assets，push 到 `main` 由 GitHub Actions 自动部署。

## 署名与版权

- 算法思路与项目设计版权归 **Eray Zesen**，原项目 [erayzesen/QuarkPhysics](https://github.com/erayzesen/QuarkPhysics)，MIT License。
- 原项目文档：<https://erayzesen.github.io/QuarkPhysics/documentation/>
- 本仓库是独立的 JavaScript 再实现与网页化呈现，同样以 MIT 协议开放。

本站是「AI 知识开放计划」第 17 期——把必须 clone 下来才能跑的好东西，做成一个点开就能玩的链接。
