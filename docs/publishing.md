# 发布到 GitHub

这个目录本身就是一个可以独立发布的仓库，不需要构建产物。

## 1. 建议的仓库信息

- **仓库名**：`bilibili-volume-balancer`
- **描述**：`B站网页视频响度均衡扩展：按 EBU R128 测量并拉齐不同视频的音量。`
- **Topics**：`bilibili`、`chrome-extension`、`edge-extension`、`loudness`、`ebu-r128`、`web-audio`
- **License**：MIT（已放在 `LICENSE`）

## 2. 创建仓库并推送

在 GitHub 上新建一个空仓库，**不要**勾选自动生成 README、.gitignore 或 LICENSE，避免和已有文件冲突。

然后在本目录执行：

```bash
git init
git add .
git commit -m "feat: initial release"
git branch -M main
git remote add origin https://github.com/<你的用户名>/bilibili-volume-balancer.git
git push -u origin main
```

使用 SSH 的话，把 remote 换成：

```bash
git remote add origin git@github.com:<你的用户名>/bilibili-volume-balancer.git
```

如果本机安装了 `gh` 并已登录，也可以一步完成：

```bash
gh repo create bilibili-volume-balancer --public --source=. --remote=origin --push
```

## 3. 发布安装包

`bilibili-volume-balancer.zip` 被 `.gitignore` 排除，不建议提交到源码仓库。把它放到 GitHub Releases：

1. 打 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

2. 在 GitHub 仓库页面进入 **Releases → Draft a new release**；
3. 选择 `v0.1.0`，上传 `bilibili-volume-balancer.zip`；
4. 在说明里写清楚安装方式：解压 → 浏览器扩展页 → 开发者模式 → 加载已解压的扩展。

## 4. 发布前检查清单

- [ ] `git status` 中没有 `*.zip`、`node_modules`、`.edge-profile`；
- [ ] `npm test` 通过（Node 22+）；
- [ ] `npm run check` 通过；
- [ ] 在真实的 Chrome / Edge 里加载一次，确认面板出现；
- [ ] README 里的截图路径 `docs/panel.png` 正常显示；
- [ ] 保留非官方声明：与哔哩哔哩无隶属关系；
- [ ] 不要把 B 站视频、音频或登录态上传到仓库。

## 5. 关于截图和素材

`docs/panel.png` 是在 B 站页面上截的控制面板，背景里可能带有少量页面元素。它只用于说明扩展功能，不构成对 B 站内容的再分发。若你希望仓库完全干净，可以：

- 用一张纯色背景 + 面板的截图替换它；或
- 从 README 中删除截图，只保留文字说明。

测试视频 `test/e2e/level-test.webm` 是用 ffmpeg 生成的正弦波和纯色画面，不包含第三方内容，可以安全提交。
