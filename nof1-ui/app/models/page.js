"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "classnames";
import useSWR from "swr";
import CoinBadge from "../../components/CoinBadge";
import {
  DEFAULT_MODEL_ICON,
  MODEL_ICON_CHOICES,
  CUSTOM_ICON_VALUE,
  resolveModelIcon,
} from "../../lib/modelIcons";

/** @typedef {"openai"|"deepseek"|"anthropic"|"gemini"|"qwen"|"zhipu"|"moonshot"|"xai_grok"|"doubao"|"minimax"|"wenxin"|"custom"} ProviderId */

/** @type {Array<{id: ProviderId,label: string}>} */
const PROVIDER_OPTIONS = [
  { id: "openai", label: "GPT / OpenAI", icon: "icon:gpt" },
  { id: "deepseek", label: "DeepSeek", icon: "icon:deepseek" },
  { id: "anthropic", label: "Claude", icon: "icon:claude" },
  { id: "gemini", label: "Gemini", icon: "icon:gemini" },
  { id: "qwen", label: "Qwen / Dashscope", icon: "icon:qwen" },
  { id: "zhipu", label: "GLM / 智谱", icon: "icon:zhipu" },
  { id: "moonshot", label: "Moonshot", icon: "icon:kimi" },
  { id: "xai_grok", label: "Grok", icon: "icon:grok" },
  { id: "doubao", label: "Doubao / 火山", icon: "icon:doubao" },
  { id: "minimax", label: "MiniMax", icon: "icon:minimax" },
  { id: "wenxin", label: "Wenxin", icon: "icon:wenxin" },
  { id: "custom", label: "Custom / 自定义", icon: DEFAULT_MODEL_ICON },
];

/** @type {Record<ProviderId,string>} */
const PROVIDER_DEFAULT_BASE_URL = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  qwen: "https://dashscope.aliyuncs.com",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.ai/v1",
  xai_grok: "https://api.x.ai/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  minimax: "https://api.minimax.io/v1",
  wenxin: "https://api.baidu.com/ernie-bot/v1",
  custom: "",
};

const fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
};

const DEFAULT_MARGIN_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];
/** @type {ProviderId} */
const DEFAULT_PROVIDER = "deepseek";
const PROVIDER_ICON_MAP = PROVIDER_OPTIONS.reduce((acc, option) => {
  acc[option.id] = option.icon || DEFAULT_MODEL_ICON;
  return acc;
}, {});

function inferProviderFromBaseUrl(baseUrl = "") {
  const normalized = baseUrl.trim().toLowerCase();
  if (!normalized) return "custom";
  const match = Object.entries(PROVIDER_DEFAULT_BASE_URL).find(
    ([, url]) => url && url.trim().toLowerCase() === normalized
  );
  return (match?.[0] ?? "custom");
}

function buildTextIconFromName(name = "") {
  const trimmed = name.trim().toUpperCase();
  const char = trimmed ? trimmed[0] : "A";
  return `text:${char}`;
}

function getProviderIconValue(providerId, currentIcon, displayName) {
  if (providerId === "custom") {
    return buildTextIconFromName(displayName);
  }
  return PROVIDER_ICON_MAP[providerId] || DEFAULT_MODEL_ICON;
}

function resolveDisplayIcon(providerId, displayIcon, displayName) {
  const provider = providerId || DEFAULT_PROVIDER;
  // If icon is missing or still the default while provider is not OpenAI, prefer the provider icon.
  if (!displayIcon || (displayIcon === DEFAULT_MODEL_ICON && provider !== "openai")) {
    return getProviderIconValue(provider, displayIcon, displayName);
  }
  return displayIcon;
}

const PLACEHOLDER_LIBRARY = [
  {
    token: "minutes_since_start",
    label: "运行分钟数",
    description: "距离实验初始化所经过的分钟数。",
    sample_value: "17802",
  },
  {
    token: "current_time",
    label: "当前时间",
    description: "当前服务器时间（ISO 字符串）。",
    sample_value: "2025-11-03T21:51:04.603Z",
  },
  {
    token: "num_invocations",
    label: "累计调用次数",
    description: "触发模型决策的累计次数。",
    sample_value: "6634",
  },
  {
    token: "market_state_text",
    label: "市场状态摘要",
    description: "多币种行情、指标与历史序列摘要。",
    sample_value: "### ALL BTC DATA ...",
  },
  {
    token: "sharpe_ratio",
    label: "夏普比率",
    description: "根据账户时间序列计算的夏普比率。",
    sample_value: "0.359",
  },
  {
    token: "position_state_text",
    label: "仓位状态摘要",
    description: "当前账户净值、持仓与风险的总结。",
    sample_value: "Current Total Return (percent): -57.08% ...",
  },
];

const EMPTY_FORM = {
  display_name: "",
  api_base_url: "",
  api_key: "",
  provider: DEFAULT_PROVIDER,
  system_prompt: "",
  user_prompt: "",
  human_review_required: false,
  auto_run_enabled: false,
  auto_run_interval_minutes: 5,
  prompt_template_id: "",
  display_icon: DEFAULT_MODEL_ICON,
  margin_config: {},
  allowed_symbols: [],
};

function formatDate(timestamp) {
  if (!timestamp) return "尚未更新";
  try {
    const value = new Date(timestamp);
    if (Number.isNaN(value.getTime())) return "尚未更新";
    return value.toLocaleString("zh-CN");
  } catch (err) {
    console.warn("Failed to format date", err);
    return "尚未更新";
  }
}

function relativeTimeLabel(timestamp, { futurePrefix = "约", pastSuffix = "前" } = {}) {
  if (!timestamp) return "等待调度";
  const target = new Date(timestamp).getTime();
  if (Number.isNaN(target)) return "等待调度";
  const diff = target - Date.now();
  const minutes = Math.max(0, Math.round(Math.abs(diff) / 60000));

  if (diff >= 0) {
    if (minutes === 0) return "即将执行";
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${futurePrefix}${hours} 小时${mins ? ` ${mins} 分钟` : ""}后`;
    }
    return `${futurePrefix}${minutes} 分钟后`;
  }

  if (minutes === 0) return "刚刚";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} 小时${mins ? ` ${mins} 分钟` : ""}${pastSuffix}`;
  }
  return `${minutes} 分钟${pastSuffix}`;
}

function truncate(text, max = 140) {
  if (!text) return "（未设置）";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function normalizeSymbolBase(symbol = "") {
  return String(symbol ?? "").toUpperCase().replace(/USDT$/i, "");
}

function extractTokensFromText(...payloads) {
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  const tokens = new Set();
  payloads
    .filter((text) => typeof text === "string" && text.length)
    .forEach((text) => {
      regex.lastIndex = 0;
      let match = regex.exec(text);
      while (match) {
        tokens.add(match[1]);
        match = regex.exec(text);
      }
    });
  regex.lastIndex = 0;
  return Array.from(tokens);
}

function PlaceholderChips({ tokens }) {
  if (!tokens?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tokens.map((token) => (
        <span
          key={token}
          className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600"
        >
          {`{${token}}`}
        </span>
      ))}
    </div>
  );
}

function TemplateCard({ template, active, onSelect, onDuplicate, onDelete }) {
  return (
    <div
      className={clsx(
        "group relative flex flex-col overflow-hidden rounded-3xl border p-6 transition-all duration-300",
        active
          ? "border-blue-500/50 bg-blue-50/50 shadow-lg ring-1 ring-blue-500/20"
          : "border-gray-200/60 bg-white hover:border-gray-300 hover:shadow-xl hover:shadow-gray-200/50 hover:-translate-y-0.5"
      )}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h4 className={clsx("text-lg font-semibold tracking-tight transition-colors", active ? "text-blue-700" : "text-gray-900")}>
            {template.template_name}
          </h4>
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{template.description || "无描述"}</p>
        </div>
        {template.is_default && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-gray-900 px-2.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
            默认
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-6 flex-1 content-start">
        {template.placeholder_tokens?.slice(0, 5).map((token) => (
          <span key={token} className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            {`{${token}}`}
          </span>
        ))}
        {template.placeholder_tokens?.length > 5 && (
          <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-400">
            +{template.placeholder_tokens.length - 5}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={() => onSelect(template)}
          className="flex-1 rounded-xl bg-gray-900 py-2 text-xs font-medium text-white transition-transform active:scale-95 hover:bg-gray-800"
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(template)}
          className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 active:scale-95"
          title="复制"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onDelete(template)}
          className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 active:scale-95"
          title="删除"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function TemplateDrawer({ open, onClose, draft, onChange, onSave, saving, placeholders }) {
  const systemRef = useRef(null);
  const userRef = useRef(null);
  const [activeField, setActiveField] = useState("system_prompt");

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const handleFieldChange = (field, value) => {
    const next = { ...draft, [field]: value };
    if (field === "system_prompt" || field === "user_prompt") {
      next.placeholder_tokens = extractTokensFromText(next.system_prompt, next.user_prompt);
    }
    onChange(next);
  };

  const insertToken = (token) => {
    const ref = activeField === "system_prompt" ? systemRef : userRef;
    const element = ref.current;
    if (!element) return;
    const { selectionStart = element.value.length, selectionEnd = selectionStart } = element;
    const nextValue =
      element.value.slice(0, selectionStart) + `{${token}}` + element.value.slice(selectionEnd);
    handleFieldChange(activeField, nextValue);
    requestAnimationFrame(() => {
      const cursor = selectionStart + token.length + 2;
      element.selectionStart = cursor;
      element.selectionEnd = cursor;
      element.focus();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative h-full w-full max-w-2xl bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{draft?.id ? "编辑模板" : "新建模板"}</h2>
            <p className="text-xs text-gray-500 mt-0.5">配置 AI 的角色设定与任务指令</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模板名称 <span className="text-red-500">*</span></label>
              <input
                required
                value={draft.template_name}
                onChange={(event) => handleFieldChange("template_name", event.target.value)}
                placeholder="例如：积极交易策略"
                className="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模板描述</label>
              <input
                value={draft.description}
                onChange={(event) => handleFieldChange("description", event.target.value)}
                placeholder="简要描述这个模板的用途"
                className="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors"
              />
            </div>
            <label className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={Boolean(draft.is_default)}
                onChange={(event) => handleFieldChange("is_default", event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="block text-sm font-medium text-gray-900">设为默认模板</span>
                <span className="block text-xs text-gray-500">新创建的模型将自动引用此模板</span>
              </div>
            </label>
          </div>

          {/* Prompts */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                系统提示词 (System)
              </label>
              <textarea
                ref={systemRef}
                value={draft.system_prompt}
                onFocus={() => setActiveField("system_prompt")}
                onChange={(event) => handleFieldChange("system_prompt", event.target.value)}
                rows={12}
                placeholder="定义 AI 的角色和行为规范..."
                className="flex-1 rounded-xl border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors resize-none"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                用户提示词 (User)
              </label>
              <textarea
                ref={userRef}
                value={draft.user_prompt}
                onFocus={() => setActiveField("user_prompt")}
                onChange={(event) => handleFieldChange("user_prompt", event.target.value)}
                rows={12}
                placeholder="提供具体的任务指令和上下文信息..."
                className="flex-1 rounded-xl border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-900 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500 transition-colors resize-none"
              />
            </div>
          </div>

          {/* Placeholders */}
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                已使用的占位符
              </p>
              <PlaceholderChips tokens={draft.placeholder_tokens} />
              {!draft.placeholder_tokens?.length && (
                <p className="text-xs text-gray-400 italic">尚未使用任何占位符</p>
              )}
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3 flex items-center justify-between">
                <span>可插入变量</span>
                <span className="text-[10px] font-normal normal-case opacity-70">点击插入到光标位置</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {placeholders.map((item) => (
                  <button
                    key={item.token}
                    type="button"
                    onClick={() => insertToken(item.token)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-mono font-medium text-blue-700 shadow-sm transition-all hover:border-blue-300 hover:shadow-md active:scale-95"
                    title={item.description}
                  >
                    {`{${item.token}}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 bg-gray-50/50 flex justify-end gap-3 sticky bottom-0">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              onClick={(e) => { e.preventDefault(); onSave(); }}
              disabled={saving}
              className="px-6 py-2.5 rounded-xl text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {saving ? "保存中..." : "保存模板"}
            </button>
        </div>
      </div>
    </div>
  );
}

function PromptTemplatesPanel({ templates, placeholders, loading, error, mutateTemplates, drawerOpen, setDrawerOpen, draft, setDraft }) {
  const [feedback, setFeedback] = useState(null);
  const [panelError, setPanelError] = useState(null);
  const [saving, setSaving] = useState(false);

  const openDrawer = (template = null) => {
    setPanelError(null);
    setFeedback(null);
    if (template === null) {
      setDraft({
        id: null,
        template_name: "新模板",
        description: "",
        system_prompt: "",
        user_prompt: "",
        placeholder_tokens: [],
        is_default: false,
      });
    } else {
      setDraft({ ...template });
    }
    setDrawerOpen(true);
  };

  const handleDuplicate = (template) => {
    openDrawer({
      ...template,
      id: null,
      template_name: `${template.template_name}（副本）`,
      is_default: false,
    });
  };

  const handleDelete = async (template) => {
    if (!window.confirm(`确定删除模板「${template.template_name}」吗？`)) {
      return;
    }
    setPanelError(null);
    setFeedback(null);
    try {
      const resp = await fetch(`/api/prompt-templates/${template.id}`, { method: "DELETE" });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(result.error || "删除失败");
      }
      await mutateTemplates();
      setFeedback("模板已删除");
    } catch (err) {
      setPanelError(err.message || "删除失败");
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setPanelError(null);
    setFeedback(null);
    try {
      const payload = {
        template_name: draft.template_name?.trim(),
        description: draft.description ?? "",
        system_prompt: draft.system_prompt ?? "",
        user_prompt: draft.user_prompt ?? "",
        is_default: Boolean(draft.is_default),
        placeholder_tokens: draft.placeholder_tokens?.length
          ? draft.placeholder_tokens
          : extractTokensFromText(draft.system_prompt, draft.user_prompt),
      };
      const endpoint = draft.id ? `/api/prompt-templates/${draft.id}` : "/api/prompt-templates";
      const method = draft.id ? "PUT" : "POST";
      const resp = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(result.error || "保存失败");
      }
      await mutateTemplates();
      setFeedback(draft.id ? "模板已更新" : "模板已创建");
      setDrawerOpen(false);
    } catch (err) {
      setPanelError(err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      {feedback ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {feedback}
        </div>
      ) : null}
      {panelError ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {panelError}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 p-6 text-sm text-neutral-500">
          正在加载模板...
        </div>
      ) : error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          模板列表加载失败，请稍后重试。
        </div>
      ) : templates.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 p-6 text-sm text-neutral-500">
          还没有模板，点击右上角创建一个吧。
        </div>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              active={draft?.id === template.id && drawerOpen}
              onSelect={() => openDrawer(template)}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <TemplateDrawer
        open={drawerOpen}
        draft={draft}
        onClose={() => setDrawerOpen(false)}
        onChange={setDraft}
        onSave={handleSave}
        saving={saving}
        placeholders={placeholders}
      />
    </div>
  );
}

function ModelAvatar({ icon, size = "lg" }) {
  const info = resolveModelIcon(icon);
  const dimension =
    size === "lg"
      ? "h-12 w-12"
      : size === "md"
        ? "h-8 w-8"
        : "h-6 w-6";

  if (info?.type === "image") {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full bg-white/60 p-1 shadow ${dimension}`}
      >
        <img
          src={info.src}
          alt={info.alt ?? "模型图标"}
          className="h-full w-full rounded-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-white px-3 py-1 text-base font-semibold shadow ${dimension}`}
    >
      {info?.text ?? "⚙"}
    </span>
  );
}

function ModelCard({ model, onEdit, onDelete, onToggleAutoRun }) {
  const runningLabel = model.auto_run_enabled
    ? `运行中 · ${model.auto_run_interval_minutes || 5}m`
    : "已暂停";
  const lastRunLabel = model.last_auto_run_at
    ? relativeTimeLabel(model.last_auto_run_at, { futurePrefix: "", pastSuffix: "前" })
    : "尚未执行";
  const nextRunLabel = model.auto_run_enabled
    ? model.next_auto_run_at
      ? relativeTimeLabel(model.next_auto_run_at)
      : "正在排队"
    : "自动运行已关闭";
  const lastRunTitle = model.last_auto_run_at ? formatDate(model.last_auto_run_at) : "";
  const nextRunTitle =
    model.auto_run_enabled && model.next_auto_run_at ? formatDate(model.next_auto_run_at) : "";

  return (
    <div
      onClick={() => onEdit(model)}
      className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 transition-all duration-300 hover:shadow-xl hover:shadow-gray-200/50 hover:-translate-y-0.5 cursor-pointer"
    >
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="relative">
             <ModelAvatar icon={model.display_icon} size="lg" />
             {model.auto_run_enabled && (
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                </span>
             )}
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
              {model.display_name || model.model_id}
            </h3>
            <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                    {model.model_id}
                </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
                onClick={(e) => { e.stopPropagation(); onToggleAutoRun(model); }}
                className={clsx(
                    "p-2 rounded-full transition-colors",
                    model.auto_run_enabled ? "bg-amber-100 text-amber-600 hover:bg-amber-200" : "bg-green-100 text-green-600 hover:bg-green-200"
                )}
                title={model.auto_run_enabled ? "暂停自动运行" : "开启自动运行"}
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {model.auto_run_enabled ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                    ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    )}
                </svg>
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(model); }}
                className="p-2 rounded-full bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600 transition-colors"
                title="删除模型"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
         <div className="rounded-2xl bg-gray-50 p-3">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">状态</p>
            <p className={clsx("text-sm font-semibold", model.auto_run_enabled ? "text-green-600" : "text-gray-500")}>
                {runningLabel}
            </p>
         </div>
         <div className="rounded-2xl bg-gray-50 p-3">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">审核</p>
            <p className="text-sm font-semibold text-gray-700">
                {model.human_review_required ? "需人工确认" : "自动执行"}
            </p>
         </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex flex-col">
            <span className="text-[10px] text-gray-400">上次运行</span>
            <span className="text-xs font-medium text-gray-600" title={lastRunTitle}>{lastRunLabel}</span>
        </div>
        <div className="flex flex-col items-end">
            <span className="text-[10px] text-gray-400">下次运行</span>
            <span className="text-xs font-medium text-gray-600" title={nextRunTitle}>{nextRunLabel}</span>
        </div>
      </div>
    </div>
  );
}

function FormModal({
  formState,
  onChange,
  onClose,
  onSubmit,
  mode,
  saving,
  promptTemplates,
  symbols = [],
  onOpenSymbolDrawer = () => {},
  onLoadMarketList = () => {},
}) {
  const isEdit = mode === "edit";
  const templateOptions = promptTemplates || [];
  const missingTemplate =
    templateOptions.length === 0 || !formState.prompt_template_id;
  const selectedTemplate = !missingTemplate
    ? templateOptions.find((tpl) => tpl.id === formState.prompt_template_id)
    : null;
  const providerValue = formState.provider ?? DEFAULT_PROVIDER;
  const providerIconValue = getProviderIconValue(providerValue, formState.display_icon, formState.display_name);
  const availableSymbols = useMemo(
    () => (symbols.length ? symbols : DEFAULT_MARGIN_SYMBOLS),
    [symbols]
  );
  const allowedSelection =
    Array.isArray(formState.allowed_symbols) && formState.allowed_symbols.length
      ? formState.allowed_symbols
      : availableSymbols;

  useEffect(() => {
    if (selectedTemplate) {
      onChange((prev) => ({
        ...prev,
        system_prompt: selectedTemplate.system_prompt ?? "",
        user_prompt: selectedTemplate.user_prompt ?? "",
      }));
    }
  }, [selectedTemplate, onChange]);

  const handleTemplateChange = (event) => {
    const nextValue = event.target.value;
    if (!nextValue) return;
    const template = templateOptions.find((tpl) => tpl.id === nextValue);
    onChange({
      ...formState,
      prompt_template_id: nextValue,
      system_prompt: template?.system_prompt ?? "",
      user_prompt: template?.user_prompt ?? "",
    });
  };

  const handleProviderSelect = (providerId) => {
    const fallback = PROVIDER_DEFAULT_BASE_URL[providerId] ?? "";
    onChange({
      ...formState,
      provider: providerId,
      api_base_url: fallback,
      display_icon:
        providerId === "custom"
          ? buildTextIconFromName(formState.display_name ?? "")
          : PROVIDER_ICON_MAP[providerId] || DEFAULT_MODEL_ICON,
    });
  };
  const handleBaseUrlChange = (value) => {
    onChange({
      ...formState,
      api_base_url: value,
    });
  };
  const handleApiKeyChange = (value) => {
    onChange({
      ...formState,
      api_key: value,
    });
  };

  const handleMarginModeChange = (symbol, value) => {
    const normalized = value === "isolated" ? "isolated" : "cross";
    onChange((prev) => ({
      ...prev,
      margin_config: {
        ...(prev.margin_config ?? {}),
        [symbol]: normalized,
      },
    }));
  };

  const toggleAllowedSymbol = (symbol) => {
    const normalized = String(symbol ?? "").toUpperCase().replace(/USDT$/i, "");
    onChange((prev) => {
      const current = Array.isArray(prev.allowed_symbols) ? prev.allowed_symbols : [];
      const exists = current.includes(normalized);
      const next = exists
        ? current.filter((s) => s !== normalized)
        : [...current, normalized];
      return { ...prev, allowed_symbols: next };
    });
  };

  const setAllAllowed = (value) => {
    onChange((prev) => ({
      ...prev,
      allowed_symbols: value ? [...availableSymbols] : [],
    }));
  };

  return (
    <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-gray-200 bg-white p-8 shadow-2xl">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            {isEdit ? "编辑模型" : "新增模型"}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            配置模型连接参数与交易策略
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-4">
            <label className="block">
                <span className="text-sm font-medium text-gray-700 mb-1.5 block">显示名称</span>
                <input
                    required
                    value={formState.display_name}
                    onChange={(event) => onChange({ ...formState, display_name: event.target.value })}
                    className="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors"
                    placeholder="例如：DeepSeek 趋势策略"
                />
            </label>

            <div className="grid grid-cols-2 gap-4">
                <label className="block">
                    <span className="text-sm font-medium text-gray-700 mb-1.5 block">模型提供商</span>
                    <div className="relative">
                        <select
                        value={providerValue}
                        onChange={(event) => handleProviderSelect(event.target.value)}
                        className="w-full appearance-none rounded-xl border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors"
                        >
                        {PROVIDER_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                            {option.label}
                            </option>
                        ))}
                        </select>
                        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                            <ModelAvatar icon={providerIconValue} size="sm" />
                        </div>
                    </div>
                </label>
                <label className="block">
                    <span className="text-sm font-medium text-gray-700 mb-1.5 block">API Key</span>
                    <input
                        type="password"
                        value={formState.api_key}
                        onChange={(event) => handleApiKeyChange(event.target.value)}
                        className="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors"
                        placeholder="sk-..."
                    />
                </label>
            </div>

            <label className="block">
                <span className="text-sm font-medium text-gray-700 mb-1.5 block">API Base URL</span>
                <input
                    value={formState.api_base_url}
                    onChange={(event) => handleBaseUrlChange(event.target.value)}
                    className="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors font-mono text-xs"
                    placeholder={PROVIDER_DEFAULT_BASE_URL[providerValue] || "https://..."}
                />
            </label>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-5 py-4 backdrop-blur-sm">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">交易对配置</h3>
              <p className="text-xs text-gray-500 mt-0.5">配置允许交易的币种及保证金模式</p>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenSymbolDrawer();
                onLoadMarketList();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-gray-800 hover:shadow-md active:scale-95"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加币种
            </button>
          </div>
          
          <div className="max-h-[320px] overflow-y-auto">
            {allowedSelection.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="rounded-full bg-gray-100 p-3 mb-3">
                    <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-900">暂无交易币种</p>
                  <p className="text-xs text-gray-500 mt-1">请点击右上角按钮添加</p>
               </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase sticky top-0 z-10">
                  <tr>
                    <th className="px-5 py-3 font-medium">币种</th>
                    <th className="px-5 py-3 font-medium text-right">保证金模式</th>
                    <th className="px-5 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allowedSelection.map((symbol) => {
                     const marginValue = formState.margin_config?.[symbol] ?? "cross";
                     return (
                       <tr key={symbol} className="group hover:bg-gray-50/50 transition-colors">
                         <td className="px-5 py-3">
                           <div className="flex items-center gap-3">
                             <CoinBadge symbol={symbol} size={28} />
                             <span className="font-bold text-gray-900 font-mono">{symbol}</span>
                           </div>
                         </td>
                         <td className="px-5 py-3 text-right">
                            <select
                              value={marginValue}
                              onChange={(e) => handleMarginModeChange(symbol, e.target.value)}
                              className="text-xs border-none bg-gray-100 rounded-lg py-1.5 pl-3 pr-8 focus:ring-0 cursor-pointer hover:bg-gray-200 transition-colors font-medium text-gray-700"
                            >
                              <option value="cross">全仓 (Cross)</option>
                              <option value="isolated">逐仓 (Isolated)</option>
                            </select>
                         </td>
                         <td className="px-5 py-3 text-right">
                           <button
                             type="button"
                             onClick={() => toggleAllowedSymbol(symbol)}
                             className="text-gray-300 hover:text-red-500 transition-colors p-1.5 rounded-md hover:bg-red-50"
                             title="移除"
                           >
                             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                             </svg>
                           </button>
                         </td>
                       </tr>
                     );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="space-y-4">
            <label className="block">
            <span className="text-sm font-medium text-gray-700 mb-1.5 block">提示词模板</span>
            <select
                value={formState.prompt_template_id || ""}
                onChange={handleTemplateChange}
                disabled={!templateOptions.length}
                className="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors disabled:opacity-50"
            >
                {templateOptions.length === 0 ? (
                <option value="">暂未配置模板</option>
                ) : (
                templateOptions.map((template) => (
                    <option key={template.id} value={template.id}>
                    {template.template_name}
                    {template.is_default ? "（默认）" : ""}
                    </option>
                ))
                )}
            </select>
            </label>

            <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 cursor-pointer hover:border-gray-300 transition-colors">
                    <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">人工审核</span>
                    <span className="text-xs text-gray-500">交易需人工批准</span>
                    </div>
                    <input
                    type="checkbox"
                    checked={formState.human_review_required}
                    onChange={(event) => onChange({ ...formState, human_review_required: event.target.checked })}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                </label>

                <label className="block">
                    <span className="text-sm font-medium text-gray-700 mb-1.5 block">自动执行周期 (分钟)</span>
                    <input
                    type="number"
                    min={1}
                    value={formState.auto_run_interval_minutes}
                    onChange={(event) =>
                        onChange({
                        ...formState,
                        auto_run_interval_minutes: Number(event.target.value || 1),
                        })
                    }
                    className="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:bg-white focus:ring-blue-500 transition-colors"
                    />
                </label>
            </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
                取消
            </button>
            <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded-xl text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {saving ? "保存中..." : "保存配置"}
            </button>
        </div>
      </form>
    </div>
  );
}

export default function ModelsPage() {
  const { data, error, isLoading, mutate } = useSWR("/api/models?includeSecrets=false", fetcher);
  const models = useMemo(() => {
    return (data?.models ?? [])
      .filter((model) => model.model_id !== "btc_benchmark")
      .map((model) => {
        const inferredProvider = inferProviderFromBaseUrl(model.api_base_url ?? "");
        const icon =
          model.display_icon ||
          (inferredProvider ? getProviderIconValue(inferredProvider, model.display_icon, model.display_name) : null) ||
          DEFAULT_MODEL_ICON;

        if (model.display_icon === DEFAULT_MODEL_ICON && inferredProvider && inferredProvider !== "openai") {
          return { ...model, display_icon: getProviderIconValue(inferredProvider, model.display_icon, model.display_name) };
        }

        return { ...model, display_icon: icon };
      });
  }, [data]);

  const {
    data: templateData,
    error: templateError,
    isLoading: templatesLoading,
    mutate: mutateTemplates,
  } = useSWR("/api/prompt-templates?includeContent=true", fetcher);
  const { data: symbolsData } = useSWR("/api/symbols", fetcher);
  const [marketList, setMarketList] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const { data: configData, mutate: mutateConfig } = useSWR("/api/sim-config", fetcher);


  const promptTemplates = useMemo(() => templateData?.templates ?? [], [templateData]);
  const defaultTemplateId = useMemo(() => {
    return promptTemplates.find((tpl) => tpl.is_default)?.id || promptTemplates[0]?.id || null;
  }, [promptTemplates]);
  const symbolOptions = useMemo(() => {
    const fromApi =
      symbolsData?.symbols?.map((symbol) => String(symbol ?? "").toUpperCase()).filter(Boolean) ??
      DEFAULT_MARGIN_SYMBOLS;
    return Array.from(new Set(fromApi)).sort();
  }, [symbolsData]);
  const riskMap = useMemo(() => {
    const map = {};
    (configData?.risk_limits ?? []).forEach((row) => {
      const base = String(row.symbol ?? "").toUpperCase().replace(/USDT$/i, "");
      if (!map[base]) map[base] = true;
    });
    return map;
  }, [configData]);
  const normalizeMarginConfig = (source = {}) => {
    const universe = symbolOptions.length ? symbolOptions : DEFAULT_MARGIN_SYMBOLS;
    return universe.reduce((acc, symbol) => {
      const mode = source?.[symbol];
      acc[symbol] = mode === "isolated" ? "isolated" : "cross";
      return acc;
    }, {});
  };

  const [modalState, setModalState] = useState({ open: false, mode: "create" });
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("models");

  // 提示词模板抽屉状态
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [symbolDrawerOpen, setSymbolDrawerOpen] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState("");
  const [symbolSort, setSymbolSort] = useState("volume");
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [riskDraft, setRiskDraft] = useState([]);
  const [riskSaving, setRiskSaving] = useState(false);
  // 确保按钮闭包能取到最新引用
  const openSymbolDrawer = () => setSymbolDrawerOpen(true);

  const closeModal = () => {
    setModalState({ open: false, mode: "create" });
    setFormState(EMPTY_FORM);
    setEditingId(null);
    setSaving(false);
  };

  const hydrateFormFromTemplate = (templateId) => {
    const template = promptTemplates.find((tpl) => tpl.id === templateId);
    return {
      prompt_template_id: template?.id || "",
      system_prompt: template?.system_prompt || "",
      user_prompt: template?.user_prompt || "",
    };
  };

  const openCreate = () => {
    const fallbackTemplateId =
      defaultTemplateId || promptTemplates?.[0]?.id || "";
    setModalState({ open: true, mode: "create" });
    setFormState({
      ...EMPTY_FORM,
      api_base_url: PROVIDER_DEFAULT_BASE_URL[DEFAULT_PROVIDER],
      provider: DEFAULT_PROVIDER,
      margin_config: normalizeMarginConfig(),
      display_icon: getProviderIconValue(DEFAULT_PROVIDER, DEFAULT_MODEL_ICON, ""),
      allowed_symbols: symbolOptions,
      ...hydrateFormFromTemplate(fallbackTemplateId),
    });
    setEditingId(null);
    setErrorMessage(null);
    loadMarketList();
  };

  const openCreateTemplate = () => {
    setTemplateDraft({
      id: null,
      template_name: "新模板",
      description: "",
      system_prompt: "",
      user_prompt: "",
      placeholder_tokens: [],
      is_default: false,
    });
    setTemplateDrawerOpen(true);
  };

  const openEdit = (model) => {
    if (!model?.model_id || typeof model.model_id !== "string") {
      setErrorMessage("模型数据异常，无法编辑");
      console.error("无效的 model_id:", model?.model_id);
      return;
    }

    setModalState({ open: true, mode: "edit" });
    setFormState({
      display_name: model.display_name ?? "",
      api_base_url: model.api_base_url ?? "",
      provider: inferProviderFromBaseUrl(model.api_base_url ?? ""),
      api_key: "",
      human_review_required: Boolean(model.human_review_required),
      auto_run_enabled: Boolean(model.auto_run_enabled),
      auto_run_interval_minutes: model.auto_run_interval_minutes || 5,
      prompt_template_id: model.prompt_template_id || defaultTemplateId || "",
      system_prompt: model.system_prompt || "",
      user_prompt: model.user_prompt || "",
      display_icon:
        model.display_icon ||
        getProviderIconValue(
          inferProviderFromBaseUrl(model.api_base_url ?? ""),
          DEFAULT_MODEL_ICON,
          model.display_name
        ),
      margin_config: normalizeMarginConfig(model.margin_config || {}),
      allowed_symbols:
        (model.allowed_symbols && model.allowed_symbols.length
          ? model.allowed_symbols
          : symbolOptions),
    });
    setEditingId(model.model_id);
    setErrorMessage(null);
    loadMarketList();
  };

  const handleDelete = async (model) => {
    if (!window.confirm(`确定删除模型「${model.display_name || model.model_id}」吗？`)) {
      return;
    }
    const response = await fetch(`/api/models/${model.model_id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setErrorMessage(result.error || "删除失败");
      return;
    }
    await mutate();
    setFeedback("模型已删除");
  };

  const handleToggleAutoRun = async (model) => {
    const response = await fetch(`/api/models/${model.model_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_run_enabled: !model.auto_run_enabled }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setErrorMessage(result.error || "切换自动运行失败");
      return;
    }
    await mutate();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);

    const isEdit = modalState.mode === "edit";

    if (isEdit && !editingId) {
      setErrorMessage("找不到需要编辑的模型 ID，请刷新后重试。");
      setSaving(false);
      return;
    }

    if (isEdit && editingId && !models.some((m) => m.model_id === editingId)) {
      setErrorMessage(`模型 ${editingId} 不存在，请刷新后重试。`);
      setSaving(false);
      return;
    }

    const displayName = formState.display_name?.trim();
    if (!displayName) {
      setErrorMessage("显示名称不能为空");
      setSaving(false);
      return;
    }

    const resolvedIcon = resolveDisplayIcon(
      formState.provider ?? DEFAULT_PROVIDER,
      formState.display_icon,
      displayName
    );

    const payload = {
      display_name: displayName,
      api_base_url: formState.api_base_url.trim() || null,
      human_review_required: formState.human_review_required,
      auto_run_enabled: formState.auto_run_enabled,
      auto_run_interval_minutes: formState.auto_run_interval_minutes,
      display_icon: resolvedIcon,
      margin_config: normalizeMarginConfig(formState.margin_config || {}),
      allowed_symbols: (() => {
        const cleaned = (formState.allowed_symbols || [])
          .map((s) => String(s ?? "").toUpperCase().replace(/USDT$/i, ""))
          .filter(Boolean);
        return cleaned.length ? cleaned : symbolOptions.map((s) => s.replace(/USDT$/i, "").toUpperCase());
      })(),
    };

    if (!payload.allowed_symbols.length) {
      setErrorMessage("请至少选择一个可交易币种");
      setSaving(false);
      return;
    }

    if (configData?.risk_limits) {
      const missingRisk = payload.allowed_symbols.filter((s) => !riskMap[s]);
      if (missingRisk.length) {
        const defaults = missingRisk.map((base) => ({
          symbol: `${base}USDT`,
          tier: 1,
          notional_cap: 50000,
          max_leverage: 50,
          imr: 0.02,
          mmr: 0.01,
        }));
        setRiskDraft(defaults);
        setRiskModalOpen(true);
        setSaving(false);
        return;
      }
    }

    if (formState.api_key.trim()) {
      payload.api_key = formState.api_key.trim();
    }

    if (!formState.prompt_template_id) {
      setErrorMessage("请选择提示词模板后再提交");
      setSaving(false);
      return;
    }
    payload.prompt_template_id = formState.prompt_template_id;

    const endpoint = isEdit ? `/api/models/${editingId}` : "/api/models";
    const method = isEdit ? "PUT" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setErrorMessage(result.error || "操作失败");
        setSaving(false);
        return;
      }

      await response.json();
      await mutate();
      setFeedback(isEdit ? "模型已更新" : "模型已创建");
      closeModal();
    } catch (error) {
      setErrorMessage(error?.message || "请求异常，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  // 手动加载 Binance 列表
  const loadMarketList = async (params = {}) => {
    try {
      setMarketLoading(true);
      setMarketError("");
      const url = new URL("/api/markets/binance", window.location.origin);
      url.searchParams.set("sort", params.sort ?? symbolSort);
      if (params.q ?? symbolSearch) {
        url.searchParams.set("q", params.q ?? symbolSearch);
      }
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.error || "获取 Binance 数据失败";
        setMarketError(msg);
        setMarketList([]);
        return;
      }
      const data = await res.json();
      setMarketList(Array.isArray(data?.tickers) ? data.tickers : []);
    } catch (err) {
      setMarketError(err?.message || "获取 Binance 数据失败");
      setMarketList([]);
    } finally {
      setMarketLoading(false);
    }
  };

  const saveRiskDraft = async () => {
    if (!riskDraft.length) {
      setRiskModalOpen(false);
      return;
    }
    setRiskSaving(true);
    setStatus("");
    try {
      const payload = {
        ...(configData ?? {}),
        risk_limits: [...(configData?.risk_limits ?? []), ...riskDraft],
      };
      const res = await fetch("/api/sim-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "风险分层保存失败");
      }
      mutateConfig(body, false);
      setStatus("风险分层已保存，请再次保存模型");
      setRiskModalOpen(false);
    } catch (err) {
      setErrorMessage(err.message || "风险分层保存失败");
    } finally {
      setRiskSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* 顶部导航栏 - Apple 风格分段控制器 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 backdrop-blur-md px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-white hover:text-gray-900 active:scale-95"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7M3 12h18" />
            </svg>
            返回
          </Link>
          
          {/* 分段控制器 Segmented Control */}
          <div className="inline-flex rounded-full bg-gray-100/80 p-1 shadow-inner backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setTab("models")}
              className={clsx(
                "rounded-full px-5 py-1.5 text-sm font-medium transition-all duration-200 ease-out",
                tab === "models"
                  ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(0,0,0,0.1)] ring-1 ring-black/5"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              模型管理
            </button>
            <button
              type="button"
              onClick={() => setTab("prompts")}
              className={clsx(
                "rounded-full px-5 py-1.5 text-sm font-medium transition-all duration-200 ease-out",
                tab === "prompts"
                  ? "bg-white text-gray-900 shadow-[0_1px_2px_rgba(0,0,0,0.1)] ring-1 ring-black/5"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              提示词管理
            </button>
          </div>
        </div>

        {tab === "models" ? (
          <button
            type="button"
            onClick={openCreate}
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-gray-200 transition-all duration-200 hover:bg-gray-800 hover:shadow-xl hover:-translate-y-0.5 active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增模型
          </button>
        ) : (
          <button
            type="button"
            onClick={openCreateTemplate}
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-gray-200 transition-all duration-200 hover:bg-gray-800 hover:shadow-xl hover:-translate-y-0.5 active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            创建模板
          </button>
        )}
      </div>

      {/* 成功提示 - 优化动画 */}
      {feedback ? (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300 rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 px-5 py-3.5 text-sm text-emerald-800 shadow-lg shadow-emerald-200/50 flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">{feedback}</span>
        </div>
      ) : null}

      {/* 错误提示 - 优化动画 */}
      {errorMessage ? (
        <div className="animate-in slide-in-from-top-2 fade-in duration-300 rounded-2xl border border-rose-300 bg-gradient-to-br from-rose-50 to-red-50 px-5 py-3.5 text-sm text-rose-800 shadow-lg shadow-rose-200/50 flex items-center gap-3">
          <svg className="w-5 h-5 flex-shrink-0 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">{errorMessage}</span>
        </div>
      ) : null}

      {tab === "models" && error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          模型列表加载失败，请刷新页面。
        </div>
      ) : null}

      {tab === "models" && isLoading ? (
        <div className="rounded-2xl border border-dashed border-neutral-200 p-6 text-sm text-neutral-500">
          正在加载模型列表...
        </div>
      ) : null}

      {tab === "models" && !isLoading && models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-200 p-10 text-center text-sm text-neutral-500">
          还没有模型配置，点击右上角的「新增模型」按钮创建一个吧。
        </div>
      ) : null}

      {tab === "models" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {models.map((model) => (
            <ModelCard
              key={model.model_id}
              model={model}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleAutoRun={handleToggleAutoRun}
            />
          ))}
        </div>
      ) : null}

      {tab === "prompts" ? (
        <PromptTemplatesPanel
          templates={promptTemplates}
          placeholders={PLACEHOLDER_LIBRARY}
          loading={templatesLoading}
          error={templateError}
          mutateTemplates={mutateTemplates}
          drawerOpen={templateDrawerOpen}
          setDrawerOpen={setTemplateDrawerOpen}
          draft={templateDraft}
          setDraft={setTemplateDraft}
        />
      ) : null}

      {modalState.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
          <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={closeModal} />
          <FormModal
            formState={formState}
            onChange={setFormState}
            onClose={closeModal}
            onSubmit={handleSubmit}
            mode={modalState.mode}
            saving={saving}
            promptTemplates={promptTemplates}
            symbols={symbolOptions}
            onOpenSymbolDrawer={() => setSymbolDrawerOpen(true)}
            onLoadMarketList={() => loadMarketList()}
          />
        </div>
      ) : null}

      {symbolDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-neutral-900/40 backdrop-blur-sm">
          <div className="w-full max-w-3xl h-full bg-white shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral-900">选择交易币种</h3>
                <p className="text-xs text-neutral-500">
                  数据来源：Binance 24h ticker，按 24h 交易额排序，可搜索/多选。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSymbolDrawerOpen(false)}
                className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                关闭
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="search"
                  value={symbolSearch}
                  onChange={(e) => {
                    setSymbolSearch(e.target.value);
                    loadMarketList({ q: e.target.value });
                  }}
                  placeholder="搜索符号，如 BTC / ETH"
                  className="w-64 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
                />
                <select
                  value={symbolSort}
                  onChange={(e) => {
                    setSymbolSort(e.target.value);
                    loadMarketList({ sort: e.target.value });
                  }}
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
                >
                  <option value="volume">按 24h 交易额</option>
                  <option value="percent">按 24h 涨跌幅</option>
                  <option value="price">按价格</option>
                </select>
                <div className="text-xs text-neutral-500">
                  已选 {formState.allowed_symbols?.length ?? 0} 个
                </div>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFormState((prev) => ({
                        ...(prev ?? {}),
                        allowed_symbols: marketList.map((t) => t.base),
                      }))
                    }
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    全选当前列表
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFormState((prev) => ({ ...(prev ?? {}), allowed_symbols: [] }))
                    }
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    清空
                  </button>
                </div>
              </div>

              {marketError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {marketError}
                </div>
              ) : null}
              <div className="divide-y divide-gray-100">
                {marketLoading && !marketList.length ? (
                  <div className="p-8 text-center text-sm text-gray-500">加载中...</div>
                ) : null}
                {marketList.map((ticker, idx) => {
                  const checked = (formState.allowed_symbols ?? []).includes(ticker.base);
                  return (
                    <div
                      key={`${ticker.symbol}-${idx}`}
                      onClick={() =>
                        setFormState((prev) => {
                          const current = Array.isArray(prev.allowed_symbols)
                            ? prev.allowed_symbols
                            : [];
                          const exists = current.includes(ticker.base);
                          const next = exists
                            ? current.filter((s) => s !== ticker.base)
                            : [...current, ticker.base];
                          return { ...(prev ?? {}), allowed_symbols: next };
                        })
                      }
                      className="group flex cursor-pointer items-center justify-between px-6 py-4 transition-colors hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-4">
                         <span className="w-6 text-center text-sm font-medium text-gray-400">{idx + 1}</span>
                         <CoinBadge symbol={ticker.symbol || ticker.base} size={36} />
                         <div className="flex flex-col">
                            <span className="text-base font-bold text-gray-900">{ticker.base}</span>
                            <span className="text-xs font-medium text-gray-500">Vol {Number(ticker.quoteVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                         </div>
                      </div>
                      
                      <div className="flex items-center gap-6 text-right">
                         <div className="flex w-24 flex-col items-end">
                            <span className="text-sm font-bold text-gray-900">${Number(ticker.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                            <span className="text-xs text-gray-400">Price</span>
                         </div>
                         <div className="flex w-20 items-center justify-end">
                            <span className={clsx(
                                "rounded-lg px-2.5 py-1 text-xs font-bold",
                                Number(ticker.changePercent) >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            )}>
                                {Number(ticker.changePercent) > 0 ? "+" : ""}{Number(ticker.changePercent).toFixed(2)}%
                            </span>
                         </div>
                         <div className="flex w-8 justify-end">
                            {checked ? (
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 shadow-sm transition-transform duration-200 hover:scale-110">
                                    <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            ) : (
                                <div className="h-6 w-6 rounded-full border-2 border-gray-200 transition-colors group-hover:border-gray-300" />
                            )}
                         </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {riskModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h3 className="text-lg font-semibold text-neutral-900">补充风险分层</h3>
                <p className="text-xs text-neutral-500">
                  以下币种缺少风险分层，请填写并保存后再保存模型。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRiskModalOpen(false)}
                className="rounded-full border border-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                关闭
              </button>
            </div>
            <div className="max-h-[480px] overflow-y-auto px-5 py-4">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-xs font-semibold text-neutral-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Symbol</th>
                    <th className="px-3 py-2 text-left">Notional Cap</th>
                    <th className="px-3 py-2 text-left">Max Lev</th>
                    <th className="px-3 py-2 text-left">IMR</th>
                    <th className="px-3 py-2 text-left">MMR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {riskDraft.map((row, idx) => (
                    <tr key={`${row.symbol}-${idx}`}>
                      <td className="px-3 py-2 font-mono text-xs">{row.symbol}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-sm"
                          value={row.notional_cap}
                          onChange={(e) =>
                            setRiskDraft((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], notional_cap: Number(e.target.value) };
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-sm"
                          value={row.max_leverage}
                          onChange={(e) =>
                            setRiskDraft((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], max_leverage: Number(e.target.value) };
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.0001"
                          className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-sm"
                          value={row.imr}
                          onChange={(e) =>
                            setRiskDraft((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], imr: Number(e.target.value) };
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.0001"
                          className="w-full rounded-lg border border-neutral-200 px-2 py-1 text-sm"
                          value={row.mmr}
                          onChange={(e) =>
                            setRiskDraft((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], mmr: Number(e.target.value) };
                              return next;
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-3 border-t px-5 py-3">
              <button
                type="button"
                onClick={() => setRiskModalOpen(false)}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={riskSaving}
                onClick={saveRiskDraft}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-60"
              >
                {riskSaving ? "保存中..." : "保存风险分层"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
