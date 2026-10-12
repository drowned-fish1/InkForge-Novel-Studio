# InkForge 9B 云端试用准备

检查时间：2026-10-10 14:37（北京时间）。用户确认 AutoDL 无空闲 GPU、实例未开机；本轮未部署服务、未产生新 GPU 训练任务。旧 SSH 地址握手失败，不能据此判断磁盘或模型丢失。

## 标注复核

独立逐文件检查结果：558/586 批（95.22%）通过现有结构、段落覆盖、token 上限和实体引用校验，共 7,194 片段、203,370 段原文。缺 a0541、a0560–a0586，共28批。

进度在11:00:50更新后停止，监督进程11:03:01报告 a0541 完整阅读修复失败；进度还记录 a0560 API传输/响应错误，随后26批延后。当前未发现标注或恢复进程运行。本轮没有重启付费标注调用。

1,262片段带疑点标记（17.54%），现有导出器会排除带标记片段；不能将7,194全部算成可训练SFT样本。标记包括原文文字疑点、未扎根原文的名称元数据等。14个片段少于64 token，需判断是否只是分隔或残片。所有模型自报confidence均≥0.8，不应把这种自评当独立质量证明。

抽看5个不同时段的场景目标、写作指令和原文，大体对应；此抽样不足以宣布全书语义验收。前置条件有部分由目标段本身归纳而来，仍须明确区分作者指定情境与有历史依据的既存事实。后训练前按既定计划进行分层语义抽查和防泄漏检查。

复核脚本与报告：`output/novel-training/guzhenren/dataset_v1/posttraining/audit_annotations.py`、`annotation-audit.json`。脚本只读原标注，输出独立报告，没有代替模型改写标注。

## 试用对象与加载

基座 `Qwen/Qwen3.5-9B-Base`，revision `68c46c4b3498877f3ef123c856ecfde50c39f404`，加载 `runs/cpt-final/adapter`。只加载基座不能测试此次CPT成果。最终adapter预期SHA256为 `63373c4ccca32a57065ff515246e9be2d487d25e9655cbf5cd228420292e4095`，上线前复核。

48GB卡可作为该9B短上下文推理起点；先BF16、单请求、4K/8K窗口测试显存和速度，不直接启动官方最大窗口。该版本只有CPT，优先做给定正文的续写对比；聊天指令服从度仍待SFT训练。对比原始基座与CPT最终adapter，固定提示、生成长度和采样参数。

开机后先在已有可工作的Transformers/PEFT环境做原始续写，核实adapter生效，再部署兼容接口。若选择vLLM，需另行验证当前安装版对Qwen3.5和此次LoRA目标层的支持；不直接更新训练环境。必要时在独立推理环境合并模型，保留原adapter和基座。

## 网络与API Key

API Key负责鉴权，网络地址/隧道负责连通，是两件独立的事。AutoDL实例没有独立公网IP；官方提供端口映射，并在当前开放端口文档注明需企业认证。个人试用优先SSH隧道。

云端推理服务监听 `127.0.0.1:8000`，本地建立隧道（以下使用现有地址，实例更换后以控制台为准）：

```powershell
ssh -N -L 127.0.0.1:8000:127.0.0.1:8000 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -p 19652 root@connect.westc.seetacloud.com
```

服务部署成功后，InkForge配置目标：

| 项目     | 值                                                |
| -------- | ------------------------------------------------- |
| Base URL | `http://127.0.0.1:8000/v1`                        |
| Model    | `inkforge-9b-cpt`（拟用服务别名，待实际部署）     |
| API Key  | 推理服务独立生成的随机密钥，不能复用标注供应商key |
| 认证     | Bearer                                            |

上面是配置方案，当前端点尚不存在。InkForge现有provider已支持自定义base URL与Bearer鉴权。CPT原始续写与chat-template模式应分开评价，兼容HTTP接口本身不会让Base模型获得指令训练能力。

调用链：InkForge → 本机8000端口 → SSH加密隧道 → 云端推理服务 → GPU。云GPU和隧道都须运行；仅保存key无法访问关机实例。这里的localhost属于运行InkForge的电脑，其他设备不能直接使用该地址。

未来确需公开HTTPS地址，可在账号满足条件后使用AutoDL6006/6008自定义服务，或采用具备公网入口的部署方案；公共入口要限制到所需推理路由。按当前vLLM文档，API Key仅保护指定API路径，不能把整个服务所有路径视为已经受保护。

## 开机后的验收顺序

1. 核实GPU、基座、adapter哈希、剩余磁盘和推理环境。
2. 用相同片段对比基座/CPT续写，检查重复、跑题、承接和生成速度。
3. 启动单用户鉴权接口；验证无key/错误key拒绝，有效key可调用。
4. 建SSH隧道，确认模型列表、普通与流式生成，再接InkForge writer角色。
5. 用完关闭GPU；租用计算费通常随开机时长产生，不能按token付费服务的方式理解。

## 官方依据

- AutoDL开放端口：https://www.autodl.com/docs/port/
- AutoDL SSH隧道：https://api.autodl.com/docs/ssh_proxy/
- vLLM API鉴权范围：https://docs.vllm.ai/en/stable/usage/security/
