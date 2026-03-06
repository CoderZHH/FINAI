# 快速开始：使用多提供商 LLM

## 🚀 立即使用

### 1. 在 UI 中配置（推荐）

1. 打开浏览器访问系统
2. 进入 **模型管理** 页面
3. 点击 **新建模型**
4. 按以下步骤填写:

   **基本信息:**
   - 显示名称: 例如 "GPT-4 趋势策略"
   
   **提供商配置:**
   - 模型提供商: 从下拉菜单选择
     - DeepSeek （推荐：性价比高）
     - OpenAI （推荐：稳定可靠）
     - Anthropic (Claude) （推荐：推理能力强）
     - Google (Gemini) （推荐：长上下文）
     - XAI (Grok) （Beta）
   
   - 模型名称: 根据提示输入，例如:
     - DeepSeek: `deepseek-reasoner`
     - OpenAI: `gpt-4o`
     - Anthropic: `claude-3-5-sonnet-20241022`
     - Google: `gemini-1.5-pro`
     - XAI: `grok-beta`
   
   - API Base URL: 通常无需修改（自动填充）
   - API Key: 输入您的 API 密钥

5. 配置提示词模板
6. 保存并启用

### 2. 在代码中使用

```typescript
import { callLLM } from "./lib/llm/llmClient";

// 示例 1: 使用 DeepSeek
const deepseekResult = await callLLM({
  provider: "deepseek",
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: "deepseek-reasoner",
  systemPrompt: "你是一个专业的交易助手",
  userPrompt: "分析当前市场趋势...",
  temperature: 0.2,
  maxTokens: 60000,
});

// 示例 2: 使用 OpenAI
const openaiResult = await callLLM({
  provider: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4o",
  systemPrompt: "你是一个专业的交易助手",
  userPrompt: "分析当前市场趋势...",
});

// 示例 3: 使用 Claude
const claudeResult = await callLLM({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-5-sonnet-20241022",
  systemPrompt: "你是一个专业的交易助手",
  userPrompt: "分析当前市场趋势...",
});

```

## 📋 提供商对比

| 特性 | DeepSeek | OpenAI | Anthropic | Google | XAI |
|-----|---------|--------|-----------|--------|-----|
| **价格** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **速度** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **推理能力** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **稳定性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **上下文长度** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **推理可视化** | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |

### 推荐使用场景

**DeepSeek - 日常交易决策**
- ✅ 高频交易（成本低）
- ✅ 需要查看推理过程
- ✅ 实验新策略

**OpenAI - 稳定可靠**
- ✅ 生产环境
- ✅ 需要高稳定性
- ✅ 预算充足

**Anthropic Claude - 复杂策略**
- ✅ 多因素分析
- ✅ 长期策略规划
- ✅ 风险评估

**Google Gemini - 大量数据**
- ✅ 分析历史数据
- ✅ 多币种同时分析
- ✅ 预算有限但需要大上下文

**XAI Grok - 实时信息**
- ✅ 需要最新市场信息
- ✅ 实验性项目
- ⚠️ 不推荐生产环境（Beta）

## 🔑 获取 API Key

### DeepSeek
1. 访问: https://platform.deepseek.com/
2. 注册/登录账号
3. 进入 API Keys 页面
4. 创建新密钥
5. 💰 价格: $0.14/M tokens（输入）, $0.28/M tokens（输出）

### OpenAI
1. 访问: https://platform.openai.com/
2. 注册/登录账号
3. 进入 API keys 页面
4. 创建新密钥
5. 💰 价格: GPT-4o 约 $2.50/M tokens（输入）, $10/M tokens（输出）

### Anthropic
1. 访问: https://console.anthropic.com/
2. 注册/登录账号
3. 进入 API Keys 页面
4. 创建新密钥
5. 💰 价格: Claude 3.5 Sonnet 约 $3/M tokens（输入）, $15/M tokens（输出）

### Google
1. 访问: https://ai.google.dev/
2. 登录 Google 账号
3. 获取 API Key
4. 💰 价格: Gemini 1.5 Pro 约 $1.25/M tokens（输入）, $5/M tokens（输出）
5. 🎁 免费额度: 每分钟 15 次请求

### XAI
1. 访问: https://x.ai/
2. 申请 API 访问
3. 获取 API Key
4. 💰 价格: 待公布（目前 Beta）

## ⚙️ 高级配置

### 使用自定义网关/代理

如果您使用第三方 API 网关或代理服务:

```typescript
const result = await callLLM({
  provider: "openai",
  apiKey: "your-key",
  apiBaseUrl: "https://your-proxy.com/v1", // 自定义 URL
  model: "gpt-4o",
  // ...其他参数
});
```

### 调整温度和最大 Token

```typescript
const result = await callLLM({
  provider: "deepseek",
  apiKey: "your-key",
  model: "deepseek-reasoner",
  temperature: 0.1,      // 更确定性的输出 (0-1)
  maxTokens: 8000,       // 限制输出长度
  // ...其他参数
});
```

### 推理过程可视化（DeepSeek）

DeepSeek 的 `deepseek-reasoner` 模型会返回推理过程:

```typescript
const result = await callLLM({
  provider: "deepseek",
  model: "deepseek-reasoner",
  // ...
});

// 访问推理过程
if (result.reasoning) {
}
```

## 🐛 常见问题

### 1. API Key 无效
**错误**: `Invalid API key`

**解决**:
- 检查 API Key 是否正确复制（无空格）
- 确认账户有余额
- 验证 API Key 权限

### 2. 请求失败
**错误**: `Request failed: 429`

**解决**:
- 速率限制：等待后重试
- 检查配置的 `auto_run_interval_minutes`
- 升级 API 套餐

### 3. 模型名称错误
**错误**: `Model not found`

**解决**:
- 参考文档确认正确的模型名称
- 注意大小写
- 检查模型是否需要特殊权限

### 4. 响应格式错误
**错误**: `Failed to parse response`

**解决**:
- 检查提示词是否明确要求 JSON 格式
- 查看 `result.raw` 了解原始响应
- 调整 `temperature` 降低随机性

### 5. Google API Base URL 被禁用
这是正常的！Google 使用专用 SDK，不需要配置 Base URL。

## 📊 监控和日志

系统会自动记录所有 LLM 调用:

```typescript
// 日志会包含:
logger.info("llmClient", "发送 LangChain LLM 请求", {
  provider: "openai",
  model: "gpt-4o",
  baseURL: "https://api.openai.com/v1",
});

logger.info("llmClient", "收到 LangChain 响应", {
  provider: "openai",
  reasoning: null,
  decision_keys: "array:5",
});
```

## 💡 最佳实践

1. **开发环境**: 使用 DeepSeek（便宜）
2. **生产环境**: 使用 OpenAI 或 Claude（稳定）
3. **配置多个备用模型**: 以防主模型不可用
4. **定期检查成本**: 监控 API 使用量
5. **合理设置调用频率**: 通过 `auto_run_interval_minutes` 控制
6. **使用环境变量**: 不要在代码中硬编码 API Key
7. **测试后再上线**: 先在测试模式验证决策质量

## 🔄 从单一提供商迁移

如果您之前只使用 DeepSeek，现在想尝试其他提供商:

1. 创建新模型配置（不要修改现有的）
2. 选择新的提供商
3. 使用相同的提示词模板
4. 先禁用自动运行，手动测试几次
5. 对比决策质量
6. 满意后再启用自动运行

## 📚 更多资源

- [完整文档](./LLM_PROVIDERS.md)
- [修改总结](./CHANGES_SUMMARY.md)
- [LangChain 文档](https://js.langchain.com/)

---

**有问题？** 查看日志文件或提交 Issue。
