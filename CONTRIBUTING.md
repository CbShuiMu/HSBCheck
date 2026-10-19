# 参与贡献

欢迎提交问题和改进。项目大部分代码由 AI 生成；无论是否使用 AI，请先阅读相关实现，核对行为，并说明改动的目的与验证结果。

## 本地验证

使用 Node.js 22.22.0（见 `.node-version`）：

```bash
npm ci
npm test
npm run build
```

修改解析或返现逻辑时，请添加能体现问题的回归测试。测试使用 Node.js 内置测试运行器，不依赖真实 PDF 或银行服务。

## 反馈解析问题

请说明浏览器、结单语言与版式、预期结果和实际结果。优先提供**虚构的文字坐标数据**，可参考 `tests/statements.test.js`。

请勿在 Issue、PR、截图或测试夹具中提交真实结单、密码、完整卡号、持卡人姓名或其他个人信息。删除页面可见文字并不保证 PDF 的隐藏文本和元数据已清理；无法确认时，仅描述问题。

## 返现规则变更

请说明适用卡种、活动期间和规则依据，并同步更新 `docs/rules.md`。当前规则是代码实现的估算口径，不代表银行对所有交易的实际认定。

## 提交改动

`main` 为稳定分支，日常开发统一在长期开发分支 `codex/develop` 上进行，不直接向 `main` 提交或推送。

```bash
git fetch origin
git switch codex/develop
git pull --ff-only
```

首次检出远程开发分支时，使用 `git switch --track origin/codex/develop`。

提交说明遵循 Conventional Commits，例如 `fix(rewards): correct cashback calculation`。完成验证后将提交推送到 `codex/develop`，提供变更摘要和验证结果，等待维护者人工确认。确认无误后才创建从 `codex/develop` 到 `main` 的 PR；合并需维护者明确授权，不自动合并。

合并后同步最新 `main` 到开发分支，再继续开发，保留长期开发分支。

PR 请简述问题、改动后的行为和验证方式。提交前检查差异，不包含 `.qa/`、`.env*`、`.dev.vars*`、构建产物或凭据。贡献按本仓库的 [MIT 许可证](LICENSE) 提供。
