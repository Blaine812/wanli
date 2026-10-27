# 喵喵小院

可爱萌宠风格的猫咪照片分享网站，使用GitHub Pages托管页面、Supabase保存图片、介绍和留言。所有访客都能上传，无需填写注册资料。

线上网址：[miaomiaojiao.cn](https://miaomiaojiao.cn/)。源码仓库：[Blaine812/wanli](https://github.com/Blaine812/wanli)。

## 已实现

- 猫咪多图上传、补充照片、缩略图切换（JPG、PNG、WebP，每次最多9张、每张最大8MB），以及名字、标签和介绍。
- 猫咪相册、每只小猫独立留言、小院留言板；留言可配多图，也能仅发送图片，支持手机和电脑。
- 小猫可无限累加点赞，不能取消；所有访客共享计数。
- 页首猫猫神上香、六种祝福造型、触发后选择小猫或填写昵称、可留空收下；透明祝福笺固定悬浮在屏幕右下角。
- 全站累计保存在数据库，个人累计用于服务端触发。祝福对象只由获得者选择一次，重复提交不会重复计数。
- 上香每次都有机会触发祝福，最迟第十次保底；触发后重新计数，前台不显示概率或门槛。弹窗通过明确操作关闭，防止留白误触和快速连点重复提交。
- 独立后台 `/admin.html`，首页无入口。账号密码登录，可搜索小猫、留言和祝福，删除单张照片、单条留言或祝福，并修改管理员密码。
- 数据保存在Supabase数据库与Storage，刷新后保留。
- 浏览器通过Supabase匿名会话提交；后台验证会话、图片签名、字段、体积、上传空间与提交频率。
- 数据表启用RLS，浏览器没有直接写表或Storage上传权限。所有写入经Edge Function检查。
- 每个访客和来源IP每小时最多10次上传、每分钟最多6次留言；相册空间默认上限1GB。

## 组成

| 路径 | 用途 |
| --- | --- |
| `src` | React页面与Supabase客户端 |
| `public/cats` | 本地保存的示例照片，无需从海外图片站加载 |
| `supabase/migrations` | 数据库、Storage和受限RPC初始化 |
| `supabase/functions/miaomiao-api` | 服务端校验与上传、留言接口 |
| `.github/workflows/pages.yml` | 检查、构建并发布GitHub Pages |

`src/config.ts` 中只有站点URL和**可公开的Publishable key**。服务端密钥由Supabase平台注入Edge Function，不写入浏览器代码或GitHub仓库。

## 本地开发

安装Node.js 24 LTS后：

```text
npm ci
npm test
npm run dev
```

开发模式完全使用本机服务和 `outputs/review-data`，与线上数据隔离。普通生产构建连接正式 Supabase；不要把本地测试次数或名单迁移到生产。

```text
npm run build
npm run preview
```

GitHub项目地址使用 `/wanli/` 前缀。自动发布会从Pages配置读取前缀；绑定自定义域名后会自动使用根路径。手动构建可以设置环境变量 `VITE_BASE_PATH=/wanli/`。

## 首次部署

1. 在Supabase的Authentication中启用Anonymous Sign-Ins。网页会自动建立匿名会话，访客无需输入账号或密码。
2. 按时间顺序应用 `supabase/migrations` 中的SQL；如果已经通过Supabase连接应用过，不要重复执行。
3. 部署 `miaomiao-api` Edge Function。`verify_jwt=false` 用于允许公开读取和CORS预检；访客写入通过 Supabase Auth 服务端验证，管理操作通过独立管理员会话验证。函数从平台读取服务端密钥。
4. 将代码提交到 `Blaine812/wanli` 的 `main` 分支。在仓库Settings → Pages中选择GitHub Actions作为发布来源。
5. 等待Actions成功，访问 `https://blaine812.github.io/wanli/`，实测相册、上传与留言。

## 使用 miaomiaojiao.cn

先验证GitHub默认地址，再在GitHub账号的Pages设置验证域名所有权，并在仓库Settings → Pages填写 `miaomiaojiao.cn`。根据GitHub提供的DNS记录修改域名解析，待HTTPS证书生效后启用HTTPS。

绑定域名后重新运行发布工作流，使资源路径切换到根路径。不要在默认地址尚未验证、DNS还未准备好时加入强制域名重定向。

托管位置和访问网络会影响国内用户的加载及上传体验，正式使用前应从实际国内网络测试。备案或接入事项按最终托管方式及服务商要求处理。

## 维护

猫咪资料在 `miaomiao_cats`，留言在 `miaomiao_comments`，图片桶为 `miaomiao-photos`。不要开放浏览器角色的表写入或Storage写入策略。站主可通过 [管理室](https://miaomiaojiao.cn/admin.html) 维护展示内容。

管理员账号为 `admin`，密码通过服务端初始化后仅保存加盐哈希，迁移文件和浏览器中不包含线上密码。首次部署需要在服务端初始化 `miaomiao_private.admin_credentials.password_hash`；已有实例不要重置密码。后台提供修改密码入口。

线上管理员会话为随机256位令牌，服务端仅保存其 SHA-256 摘要，有效期8小时；浏览器只在当前标签页的 sessionStorage 中保留令牌。退出即时撤销当前会话，改密码撤销其他会话。登录与密码校验有服务端频率限制。管理数据和凭据不向公开角色开放。

删除采用逻辑删除并在私有管理记录中保留备份，不删除原 Storage 对象。小猫最后一张照片被移除后，档案仍保留，可继续补图；祝福被移除后不清零上香或保佑历史累计。

上传失败会尽量释放预留空间。若文件上传成功后数据库提交结果无法确认，系统保留照片并重试完成提交，避免误删已经发布的照片。极少数中断可能留下未引用文件，维护时先核对 `miaomiao_cats.image_path`、`miaomiao_cat_photos.image_path`、`miaomiao_comments.image_paths` 及未完成批次，再处理Storage文件。

多图采用预留批次、逐张验证并上传、事务一次提交。提交结果不确定时重试幂等完成操作，避免误删已发布的照片。互动通过 `miaomiao_community_action` 事务更新，所有写入仍由 Edge Function 验证访客身份；新建 RPC 均仅授权服务端执行。

收藏等其他额外功能仍待站主审批，未加入本版。

示例档案为虚构内容，页面已经标注。照片来源Unsplash，资源ID：photo-1573865526739-10659fec78a5、photo-1514888286974-6c03e2ca1dba、photo-1511044568932-338cba0ad803、photo-1495360010541-f48722b34f7d、photo-1518791841217-8f162f1e1131、photo-1513360371669-4adf3dd7dff8。
