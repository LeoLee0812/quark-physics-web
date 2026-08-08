// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	// 站点部署在 Cloudflare Workers，canonical / sitemap 指向自定义域名
	site: 'https://quark.leolee0812.site',
	integrations: [
		starlight({
			title: 'Quark Physics Web · 软体物理 playground',
			// 全站中文，用 root 语言覆盖默认英文
			defaultLocale: 'root',
			locales: {
				root: { label: '简体中文', lang: 'zh-CN' },
			},
			description: '在浏览器里戳一戳会像果冻一样弹半天的 2D 软体物理',
			social: [
				{ icon: 'github', label: 'GitHub 原仓库', href: 'https://github.com/erayzesen/QuarkPhysics' },
			],
			customCss: ['./src/styles/custom.css'],
			// Cloudflare Web Analytics：手动注入 beacon，统计数据进 CF 后台
			// token 用 leolee0812.site zone 的 site_token（不是后台展示的 site tag）
			head: [
				{
					tag: 'script',
					attrs: {
						defer: true,
						src: 'https://static.cloudflareinsights.com/beacon.min.js',
						'data-cf-beacon': '{"token": "48701f7045fb436d9e1a677adce6b2e6"}',
					},
				},
			],
			// 正文以二级标题分节，目录只抓 h2/h3
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
			// 侧边栏按内容实际结构填写
			sidebar: [
				{ label: '回到 playground', link: '/' },
				{ label: '算法笔记', slug: 'guide' },
			],
		}),
	],
});
