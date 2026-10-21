# 喵喵小院

可爱萌宠风格的猫咪照片分享网站，使用GitHub Pages托管页面、Supabase保存图片、介绍和留言。所有访客都能上传，无需填写注册资料。

## 已实现

- 猫咪照片上传（JPG、PNG、WebP，最大8MB）、名字、标签和介绍。
- 猫咪相册、每只小猫独立留言、小院留言板，支持手机和电脑。
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

本地页面连接同一个Supabase项目，测试提交也会写入该项目。

```text
npm run build
npm run preview
```

GitHub项目地址使用 `/wanli/` 前缀。自动发布会从Pages配置读取前缀；绑定自定义域名后会自动使用根路径。手动构建可以设置环境变量 `VITE_BASE_PATH=/wanli/`。

## 首次部署

1. 在Supabase的Authentication中启用Anonymous Sign-Ins。网页会自动建立匿名会话，访客无需输入账号或密码。
2. 按时间顺序应用 `supabase/migrations` 中的SQL；如果已经通过Supabase连接应用过，不要重复执行。
3. 部署 `miaomiao-api` Edge Function。`verify_jwt=false` 仅用于允许公开读取和CORS预检；每个POST仍必须通过函数内部的Supabase Auth服务端验证。函数从平台读取服务端密钥。
4. 将代码提交到 `Blaine812/wanli` 的 `main` 分支。在仓库Settings → Pages中选择GitHub Actions作为发布来源。
5. 等待Actions成功，访问 `https://blaine812.github.io/wanli/`，实测相册、上传与留言。

## 使用 miaomiaojiao.cn

先验证GitHub默认地址，再在GitHub账号的Pages设置验证域名所有权，并在仓库Settings → Pages填写 `miaomiaojiao.cn`。根据GitHub提供的DNS记录修改域名解析，待HTTPS证书生效后启用HTTPS。

绑定域名后重新运行发布工作流，使资源路径切换到根路径。不要在默认地址尚未验证、DNS还未准备好时加入强制域名重定向。

托管位置和访问网络会影响国内用户的加载及上传体验，正式使用前应从实际国内网络测试。备案或接入事项按最终托管方式及服务商要求处理。

## 维护

猫咪资料在 `miaomiao_cats`，留言在 `miaomiao_comments`，图片桶为 `miaomiao-photos`。不要开放浏览器角色的表写入或Storage写入策略。Supabase控制台可用于维护数据；站点未增加管理后台。

上传失败会尽量释放预留空间。若文件上传成功后数据库提交结果无法确认，系统保留照片并重试完成提交，避免误删已经发布的照片。极少数中断可能留下未引用文件，维护时先核对 `miaomiao_cats.image_path` 再处理Storage文件。

点赞收藏、成长相册和审核后台等扩展功能仍待站主审批，未加入本版。

示例档案为虚构内容，页面已经标注。照片来源Unsplash，资源ID：photo-1573865526739-10659fec78a5、photo-1514888286974-6c03e2ca1dba、photo-1511044568932-338cba0ad803、photo-1495360010541-f48722b34f7d、photo-1518791841217-8f162f1e1131、photo-1513360371669-4adf3dd7dff8。
