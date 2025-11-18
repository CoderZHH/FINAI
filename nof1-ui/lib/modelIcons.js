const IMAGE_ICON_OPTIONS = [
  { value: "icon:gpt", label: "GPT / OpenAI", src: "/icons/models/GPT.png" },
  { value: "icon:deepseek", label: "DeepSeek", src: "/icons/models/DEEPSEEK.png" },
  { value: "icon:claude", label: "Claude", src: "/icons/models/CLAUDE.png" },
  { value: "icon:gemini", label: "Gemini", src: "/icons/models/GEMINI.png" },
  { value: "icon:qwen", label: "Qianwen / 千问", src: "/icons/models/QIANWEN.png" },
  { value: "icon:zhipu", label: "Zhipu GLM", src: "/icons/models/ZHIPU.png" },
  { value: "icon:kimi", label: "Kimi / Moonshot", src: "/icons/models/KIMI.png" },
  { value: "icon:grok", label: "Grok", src: "/icons/models/GROK.png" },
  { value: "icon:doubao", label: "Doubao", src: "/icons/models/DOUBAO.png" },
  { value: "icon:minimax", label: "Minimax", src: "/icons/models/MINIMAX.png" },
  { value: "icon:wenxin", label: "Wenxin", src: "/icons/models/WENXIN.png" },
];

const ICON_ALIAS_MAP = {
  "⚙️": "icon:gpt",
  default: "icon:gpt",
  gpt: "icon:gpt",
  "gpt-4": "icon:gpt",
  gpt4: "icon:gpt",
  openai: "icon:gpt",
  deepseek: "icon:deepseek",
  "deepseek-v3": "icon:deepseek",
  claude: "icon:claude",
  anthropic: "icon:claude",
  gemini: "icon:gemini",
  google: "icon:gemini",
  qwen: "icon:qwen",
  "qwen-max": "icon:qwen",
  qianwen: "icon:qwen",
  千问: "icon:qwen",
  文心: "icon:wenxin",
  wenxin: "icon:wenxin",
  doubao: "icon:doubao",
  zhipu: "icon:zhipu",
  glm: "icon:zhipu",
  kimi: "icon:kimi",
  moonshot: "icon:kimi",
  minimax: "icon:minimax",
  grok: "icon:grok",
};

const ICON_MAP = IMAGE_ICON_OPTIONS.reduce(
  (acc, item) => ({ ...acc, [item.value]: item }),
  {}
);

export const DEFAULT_MODEL_ICON = "icon:gpt";
export const CUSTOM_ICON_VALUE = "__custom_model_icon__";
export const MODEL_ICON_CHOICES = IMAGE_ICON_OPTIONS;

export function normaliseIconValue(iconValue) {
  if (iconValue && typeof iconValue === "object") {
    if (typeof iconValue.value === "string" && iconValue.value.trim().length) {
      return iconValue.value.trim();
    }
    if (typeof iconValue.text === "string" && iconValue.text.trim().length) {
      return iconValue.text.trim();
    }
    return DEFAULT_MODEL_ICON;
  }

  if (typeof iconValue === "string") {
    const trimmed = iconValue.trim();
    if (!trimmed.length) {
      return DEFAULT_MODEL_ICON;
    }
    const lower = trimmed.toLowerCase();
    if (ICON_ALIAS_MAP[lower]) {
      return ICON_ALIAS_MAP[lower];
    }
    if (lower.startsWith("text:") || lower.startsWith("emoji:")) {
      return trimmed;
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        return normaliseIconValue(parsed);
      } catch (err) {
        // ignore
      }
    }
    return trimmed;
  }

  return DEFAULT_MODEL_ICON;
}

export function resolveModelIcon(iconValue) {
  const key = normaliseIconValue(iconValue);
  if (typeof key === "string") {
    const lower = key.toLowerCase();
    if (lower.startsWith("text:") || lower.startsWith("emoji:")) {
      const textValue = key.split(":").slice(1).join(":").trim() || "AI";
      return {
        type: "text",
        value: key,
        text: textValue,
      };
    }
    if (key.startsWith("/")) {
      return {
        type: "image",
        value: key,
        src: key,
        alt: "自定义模型图标",
      };
    }
    if (key.startsWith("http://") || key.startsWith("https://")) {
      return {
        type: "image",
        value: key,
        src: key,
        alt: "自定义模型图标",
      };
    }
  }

  const match = ICON_MAP[key];

  if (match) {
    return {
      type: "image",
      value: key,
      src: match.src,
      alt: match.label,
    };
  }

  const fallback = ICON_MAP[DEFAULT_MODEL_ICON];
  return {
    type: "image",
    value: DEFAULT_MODEL_ICON,
    src: fallback.src,
    alt: fallback.label,
  };
}
