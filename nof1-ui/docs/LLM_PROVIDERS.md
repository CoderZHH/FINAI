# LLM 多提供商支持文档

## 概述

llmClient 现已支持多个 LLM 提供商，您可以根据需求选择不同的模型提供商来执行交易决策。

## 支持的提供商

### 1. DeepSeek
- **提供商代码**: `deepseek`
- **默认模型**: `deepseek-reasoner`
- **API Base URL**: `https://api.deepseek.com/v1`
- **推荐模型**:
  - `deepseek-reasoner` - 推理模型，支持 CoT (Chain of Thought)
  - `deepseek-chat` - 标准对话模型
- **特性**: 
  - ✅ 支持推理过程 (reasoning_content)
  - ✅ 可在 UI 中展示思维链
  - ✅ 高性价比

### 2. OpenAI
- **提供商代码**: `openai`
- **默认模型**: `gpt-4-turbo-preview`
- **API Base URL**: `https://api.openai.com/v1`
- **推荐模型**:
  - `gpt-4-turbo-preview` - GPT-4 Turbo
  - `gpt-4o` - GPT-4 Optimized
  - `gpt-3.5-turbo` - 快速且经济
- **特性**:
  - ✅ 成熟稳定
  - ✅ 广泛支持
  - ⚠️ 价格较高

### 3. Anthropic (Claude)
- **提供商代码**: `anthropic`
- **默认模型**: `claude-3-5-sonnet-20241022`
- **API Base URL**: `https://api.anthropic.com`
- **推荐模型**:
  - `claude-3-5-sonnet-20241022` - Claude 3.5 Sonnet (推荐)
  - `claude-3-opus-20240229` - Claude 3 Opus (最强性能)
  - `claude-3-haiku-20240307` - Claude 3 Haiku (快速经济)
- **特性**:
  - ✅ 卓越的推理能力
  - ✅ 长上下文支持
  - ✅ 安全性高

### 4. Google (Gemini)
- **提供商代码**: `google`
- **默认模型**: `gemini-1.5-pro`
- **API Base URL**: 无需配置（使用 Google SDK）
- **推荐模型**:
  - `gemini-1.5-pro` - Gemini 1.5 Pro
  - `gemini-1.5-flash` - Gemini 1.5 Flash (快速)
- **特性**:
  - ✅ 超长上下文窗口
  - ✅ 多模态支持
  - ✅ 免费额度较高

### 5. XAI (Grok)
- **提供商代码**: `xai`
- **默认模型**: `grok-beta`
- **API Base URL**: `https://api.x.ai/v1`
- **推荐模型**:
  - `grok-beta` - Grok Beta
  - `grok-2` - Grok 2
- **特性**:
  - ✅ 实时数据访问
  - ✅ 幽默风格
  - ⚠️ 仍在 Beta 阶段

## 使用方法

### 在代码中使用

```typescript
import { callLLM } from "./lib/llm/llmClient";

const result = await callLLM({
  provider: "openai",           // 选择提供商
  apiKey: "sk-...",             // API Key
  apiBaseUrl: null,              // 可选，使用默认 URL
  model: "gpt-4o",              // 模型名称
  systemPrompt: "你是交易助手",
  userPrompt: "分析市场...",
  temperature: 0.2,
  maxTokens: 60000,
});
```

### 在 UI 中配置

1. 进入 **模型管理** 页面
2. 点击 **新建模型** 或编辑现有模型
3. 在 **模型提供商** 下拉菜单中选择：
   - DeepSeek
   - OpenAI
   - Anthropic (Claude)
   - Google (Gemini)
   - XAI (Grok)
4. 填写相应的配置：
   - **模型名称**: 根据提示输入模型名称
   - **API Base URL**: 大多数情况下无需修改（会自动填充默认值）
   - **API Key**: 从对应提供商获取的密钥

## 配置说明

### API Key 获取

- **DeepSeek**: https://platform.deepseek.com/api_keys
- **OpenAI**: https://platform.openai.com/api-keys
- **Anthropic**: https://console.anthropic.com/
- **Google**: https://ai.google.dev/
- **XAI**: https://x.ai/api

### Base URL 说明

大多数提供商使用默认 Base URL 即可，除非：
- 使用自定义网关/代理
- 使用企业版 API
- 使用第三方兼容服务

对于 **Google Gemini**，Base URL 字段会被自动禁用，因为 Google 使用专用 SDK。

## 提供商别名

系统支持多种别名以提高兼容性：

| 提供商 | 支持的别名 |
|--------|-----------|
| DeepSeek | `deepseek` |
| OpenAI | `openai`, `gpt` |
| Anthropic | `anthropic`, `claude` |
| Google | `google`, `gemini` |
| XAI | `xai`, `grok` |

## 推理内容支持

不同提供商对推理过程的支持程度：

| 提供商 | 推理支持 | 说明 |
|--------|---------|------|
| DeepSeek | ✅ 完整支持 | 通过 `reasoning_content` 字段 |
| OpenAI | ⚠️ 部分支持 | 取决于模型（如 o1 系列） |
| Anthropic | ⚠️ 间接支持 | 可通过提示词引导 |
| Google | ⚠️ 间接支持 | 可通过提示词引导 |
| XAI | ❌ 暂不支持 | - |

## 最佳实践

1. **模型选择**:
   - 日常交易：推荐 DeepSeek（性价比高）
   - 复杂策略：推荐 Claude 3.5 Sonnet 或 GPT-4
   - 快速响应：推荐 Gemini Flash 或 GPT-3.5

2. **参数调优**:
   - `temperature: 0.1-0.3`: 交易决策需要一致性
   - `maxTokens: 4000-60000`: 根据市场数据量调整

3. **成本控制**:
   - 使用 `auto_run_interval_minutes` 控制调用频率
   - 优先使用高性价比模型进行初步筛选
   - 关键决策使用更强大的模型

4. **错误处理**:
   - 所有提供商都支持自动重试（最多 2 次）
   - 建议配置多个备用模型

## 故障排查

### 常见错误

1. **API Key 无效**
   - 检查 API Key 是否正确
   - 确认 API Key 有足够余额

2. **Base URL 错误**
   - 确认 URL 格式正确（不要以 `/` 结尾）
   - 检查网络连接

3. **模型名称错误**
   - 参考各提供商文档确认模型名称
   - 注意大小写敏感

4. **响应解析失败**
   - 检查提示词是否明确要求 JSON 格式
   - 查看日志中的原始响应内容

## 技术细节

### 架构设计

llmClient 使用工厂模式创建不同提供商的实例：

```typescript
function buildChatModel(request: CallLLMRequest): BaseChatModel {
  const provider = normalizeProvider(request.provider);
  
  switch (provider) {
    case "deepseek":
      return new ChatDeepSeek({...});
    case "openai":
      return new ChatOpenAI({...});
    // ... 其他提供商
  }
}
```

### 依赖包

所有提供商都通过 LangChain 生态系统集成：

- `@langchain/deepseek`
- `@langchain/openai`
- `@langchain/anthropic`
- `@langchain/google-genai`
- `@langchain/xai`

## 更新日志

### v2.0.0 (当前版本)
- ✅ 新增多提供商支持
- ✅ UI 改为下拉选择
- ✅ 动态提示文本
- ✅ 提供商别名支持

### v1.0.0 (初始版本)
- ✅ 仅支持 DeepSeek

## 反馈与支持

如遇到问题或有功能建议，请通过以下方式联系：
- 提交 Issue
- 查看日志文件
- 联系技术支持
