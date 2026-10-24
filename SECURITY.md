# 安全说明 / Security policy

## 报告安全问题

如果发现身份绕过、私有数据泄露、注入、权限提升或其他可利用漏洞，请不要将复现细节、访问令牌、账号凭据或真实用户记录发布到公开 Issue、Pull Request 或讨论区。

优先打开本仓库的 **Security → Advisories → Report a vulnerability**。该入口是否可用取决于仓库是否已启用 GitHub 私密漏洞报告。如果入口不可用，可以新建一个只写“希望私下报告安全问题”的 Issue，请维护者提供私密接收方式；在取得合适渠道前不要附漏洞细节或受影响数据。

私密报告建议包含受影响版本、漏洞类型、最小合成复现、预期影响和已知修复建议。只在自己有权测试的环境中验证，并尽量使用仓库的虚构演示数据。不要为证明漏洞而读取或导出无关真实数据。

## 版本范围

优先处理最新发布版本的问题。旧版本是否需要回补，取决于影响与兼容性；不要把旧 Tag 仍可下载理解为它仍具有相同的维护状态。修复和受影响版本将在适合公开时记录到 Release 或安全公告。

## 演示与自行部署

仓库 README 中的账号和口令是公开的合成演示信息，只用于本机内存演示。它们不授予线上服务权限，也不能用于互联网可访问的正式部署。演示模式不提供生产数据持久化方案。

自行部署需要独立生成凭据、设置访问权限、配置安全 Cookie 与可信来源、管理数据库和备份，并遵循依赖更新及数据库迁移流程。实际环境变量、口令、签名密钥、数据库导出、浏览器会话和私有资料不得提交到 Git。

## English

Do not disclose exploit details, credentials, tokens, or real user records in public issues or pull requests. Use **Security → Advisories → Report a vulnerability** when private reporting is enabled. If that option is unavailable, open a minimal issue requesting a private contact channel without including vulnerability details.

Include the affected version, a minimal synthetic reproduction, likely impact, and a suggested fix if available. Test only systems you are authorized to test. The public demo credentials are for localhost, in-memory demonstration only and must not be used for an Internet-facing deployment. The latest release is prioritized for security fixes; availability of older tags does not imply continuing support.
