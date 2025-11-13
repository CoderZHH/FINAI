"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "classnames";
import useSWR from "swr";
import {
  DEFAULT_MODEL_ICON,
  MODEL_ICON_CHOICES,
  CUSTOM_ICON_VALUE,
  resolveModelIcon,
} from "../../lib/modelIcons";

const fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
};

const CUSTOM_TEMPLATE_VALUE = "__custom__";

const EMPTY_FORM = {
  display_name: "",
  api_base_url: "",
  api_key: "",
  system_prompt: "",
  user_prompt: "",
  human_review_required: false,
  auto_run_enabled: false,
  auto_run_interval_minutes: 5,
  prompt_template_id: "",
  display_icon: DEFAULT_MODEL_ICON,
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
        "group relative overflow-hidden rounded-3xl border p-5 shadow-md transition-all duration-300 cursor-pointer",
        active 
          ? "border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50 shadow-lg shadow-purple-200/50 scale-105" 
          : "border-slate-200 bg-gradient-to-br from-white to-slate-50 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1"
      )}
    >
      {/* 背景装饰 */}
      <div className={clsx(
        "absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100",
        active
          ? "bg-gradient-to-br from-purple-100/60 via-pink-50/40 to-transparent"
          : "bg-gradient-to-br from-indigo-50/60 via-blue-50/40 to-transparent"
      )} />

      {/* 头部区域 */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <h4 className="text-base font-bold text-slate-900 group-hover:text-purple-600 transition-colors duration-300 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            {template.template_name}
          </h4>
          <p className="text-xs text-slate-500 mt-1">{template.description || "无描述"}</p>
        </div>
        {template.is_default ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 px-3 py-1 text-[10px] font-bold text-white shadow-md">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            默认
          </span>
        ) : null}
      </div>

      {/* Token 标签 */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {template.placeholder_tokens?.slice(0, 6).map((token) => (
          <span key={token} className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-mono font-semibold text-indigo-700 ring-1 ring-indigo-200">
            {`{${token}}`}
          </span>
        ))}
        {template.placeholder_tokens?.length > 6 ? (
          <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600">
            +{template.placeholder_tokens.length - 6}
          </span>
        ) : null}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200/60">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-purple-300/50 active:scale-95"
          onClick={() => onSelect(template)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          编辑
        </button>
        <div className="flex items-center gap-2">
          <button 
            type="button" 
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all duration-300 hover:bg-slate-200 hover:scale-105 active:scale-95" 
            onClick={() => onDuplicate(template)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            复制
          </button>
          <button 
            type="button" 
            className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-500 to-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-rose-300/50 active:scale-95" 
            onClick={() => onDelete(template)}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            删除
          </button>
        </div>
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
    <div className="fixed inset-0 z-50 flex animate-in fade-in duration-300">
      <button className="flex-1 bg-slate-900/50 backdrop-blur-sm" type="button" onClick={onClose} aria-label="关闭" />
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-2xl animate-in slide-in-from-right duration-300">
        {/* 顶部标题栏 */}
        <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/80 backdrop-blur-md p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-purple-500">提示词模板</p>
              <h2 className="text-2xl font-bold text-slate-900 mt-1 flex items-center gap-2">
                <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                {draft?.id ? "编辑模板" : "新建模板"}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border-2 border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-md transition-all duration-300 hover:scale-105 hover:bg-slate-50 hover:shadow-lg active:scale-95"
            >
              [X] 关闭
            </button>
          </div>
        </div>

        <form
          className="p-6 space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          {/* 模板名称 */}
          <label className="block">
            <span className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              模板名称
              <span className="text-rose-500">*</span>
            </span>
            <input
              required
              value={draft.template_name}
              onChange={(event) => handleFieldChange("template_name", event.target.value)}
              placeholder="例如：积极交易策略"
              className="mt-2 w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition-all duration-300 placeholder:text-slate-400 focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-100 hover:border-slate-300"
            />
          </label>

          {/* 模板描述 */}
          <label className="block">
            <span className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              模板描述
            </span>
            <input
              value={draft.description}
              onChange={(event) => handleFieldChange("description", event.target.value)}
              placeholder="简要描述这个模板的用途"
              className="mt-2 w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm transition-all duration-300 placeholder:text-slate-400 focus:border-purple-400 focus:outline-none focus:ring-4 focus:ring-purple-100 hover:border-slate-300"
            />
          </label>

          {/* 默认模板开关 */}
          <label className="flex items-center gap-3 rounded-2xl border-2 border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 px-5 py-4 text-sm text-slate-700 cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02]">
            <input
              type="checkbox"
              checked={Boolean(draft.is_default)}
              onChange={(event) => handleFieldChange("is_default", event.target.checked)}
              className="h-5 w-5 rounded border-purple-300 text-purple-600 focus:ring-purple-400 transition-all duration-300"
            />
            <span className="font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              设为默认模板
              <span className="text-xs font-normal text-purple-600">(新模型会自动引用)</span>
            </span>
          </label>

          {/* 提示词编辑区 */}
          <div className="grid gap-5 lg:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                系统提示词
              </span>
              <textarea
                ref={systemRef}
                value={draft.system_prompt}
                onFocus={() => setActiveField("system_prompt")}
                onChange={(event) => handleFieldChange("system_prompt", event.target.value)}
                rows={14}
                placeholder="定义 AI 的角色和行为规范..."
                className="rounded-2xl border-2 border-slate-200 bg-white/90 p-4 text-sm leading-relaxed text-slate-800 shadow-inner transition-all duration-300 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 hover:border-slate-300"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                用户提示词
              </span>
              <textarea
                ref={userRef}
                value={draft.user_prompt}
                onFocus={() => setActiveField("user_prompt")}
                onChange={(event) => handleFieldChange("user_prompt", event.target.value)}
                rows={14}
                placeholder="提供具体的任务指令和上下文信息..."
                className="rounded-2xl border-2 border-slate-200 bg-white/90 p-4 text-sm leading-relaxed text-slate-800 shadow-inner transition-all duration-300 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100 hover:border-slate-300"
              />
            </label>
          </div>

          {/* 模板占位符显示 */}
          <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4">
            <p className="text-sm font-bold text-emerald-800 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 8 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              已使用的占位符
              {draft.placeholder_tokens?.length > 0 && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
                  {draft.placeholder_tokens.length}
                </span>
              )}
            </p>
            <PlaceholderChips tokens={draft.placeholder_tokens} />
            {!draft.placeholder_tokens?.length && (
              <p className="text-xs text-emerald-600 italic">尚未使用任何占位符</p>
            )}
          </div>

          {/* 可插入占位符 */}
          <div className="rounded-2xl border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-5">
            <p className="text-sm font-bold text-blue-800 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              可插入的占位符
              <span className="text-xs font-normal text-blue-600">(点击插入到光标位置)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {placeholders.map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onClick={() => insertToken(item.token)}
                  className="inline-flex items-center gap-1 rounded-full border-2 border-blue-200 bg-white px-3 py-1.5 text-xs font-mono font-semibold text-blue-700 shadow-sm transition-all duration-300 hover:scale-110 hover:border-blue-400 hover:bg-blue-50 hover:shadow-md active:scale-95"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {`{${item.token}}`}
                </button>
              ))}
            </div>
          </div>

          {/* 提交按钮 */}
          <button className="flex justify-end gap-3 pt-4 border-t-2 border-slate-200"/>
          {/* 提交按钮 */}
          <div className="flex justify-end gap-3 pt-4 border-t-2 border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border-2 border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 shadow-md transition-all duration-300 hover:scale-105 hover:bg-slate-50 hover:shadow-lg active:scale-95"
            >
              [X] 取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-purple-300/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 active:scale-95"
            >
              {saving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  保存中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 transition-transform duration-300 group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  保存模板
                </>
              )}
            </button>
          </div>
        </form>
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
      {info?.text ?? "[GEAR]️"}
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
      className="group relative overflow-hidden rounded-2xl border border-neutral-200/50 bg-white/90 p-5 shadow-sm backdrop-blur-sm transition-all duration-500 ease-out cursor-pointer hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1 active:scale-[0.98]"
    >
      {/* 简约悬浮效果 */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-neutral-50 via-white to-neutral-50 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      
      {/* 顶部区域 */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3">
            <ModelAvatar icon={model.display_icon} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-neutral-900 transition-all duration-300 group-hover:text-neutral-700">
              {model.display_name || model.model_id}
            </h3>
            <p className="text-xs font-mono text-neutral-400 mt-0.5">
              {model.model_id}
            </p>
          </div>
        </div>
        
        {/* 状态指示器 */}
        <div className="flex items-center gap-2">
          {model.auto_run_enabled && (
            <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse shadow-lg shadow-green-400/50" />
          )}
          <div className={clsx(
            "h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300",
            model.auto_run_enabled 
              ? "bg-green-50 text-green-600 group-hover:bg-green-100" 
              : "bg-neutral-100 text-neutral-400 group-hover:bg-neutral-200"
          )}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {model.auto_run_enabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* 简约标签 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium text-neutral-600 transition-colors duration-300 group-hover:bg-neutral-200">
          {model.human_review_required ? "人工审核" : "自动执行"}
        </span>
        <span className={clsx(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all duration-300",
          model.auto_run_enabled
            ? "bg-green-100 text-green-700 group-hover:bg-green-200"
            : "bg-neutral-100 text-neutral-500"
        )}>
          {runningLabel}
        </span>
      </div>

      {/* 信息区 */}
      <div className="space-y-2.5 text-xs text-neutral-600 mb-4">
        <div className="flex items-start gap-2 transition-transform duration-300 hover:translate-x-1">
          <span className="mt-0.5 text-neutral-400">•</span>
          <div className="flex-1">
            <span className="text-neutral-500">模板：</span>
            <span className="ml-1 font-medium text-neutral-700">
              {model.prompt_template?.name || "自定义"}
            </span>
          </div>
        </div>
        
        <div className="flex items-start gap-2 transition-transform duration-300 hover:translate-x-1">
          <span className="mt-0.5 text-neutral-400">•</span>
          <div className="flex-1">
            <span className="text-neutral-500">系统：</span>
            <span className="ml-1 text-neutral-600 line-clamp-1">
              {truncate(model.system_prompt, 60)}
            </span>
          </div>
        </div>
        
        <div className="flex items-start gap-2 transition-transform duration-300 hover:translate-x-1">
          <span className="mt-0.5 text-neutral-400">•</span>
          <div className="flex-1">
            <span className="text-neutral-500">用户：</span>
            <span className="ml-1 text-neutral-600 line-clamp-1">
              {truncate(model.user_prompt, 60)}
            </span>
          </div>
        </div>
      </div>

      {/* 底部时间信息 */}
      <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-[10px] text-neutral-400">
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span title={lastRunTitle}>{lastRunLabel}</span>
        </div>
        <div className={clsx(
          "flex items-center gap-1.5 font-medium transition-colors duration-300",
          model.auto_run_enabled ? "text-neutral-600" : "text-neutral-400"
        )} title={nextRunTitle}>
          {nextRunLabel}
        </div>
      </div>

      {/* 悬浮操作按钮 */}
      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleAutoRun(model);
          }}
          className={clsx(
            "rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-all duration-300 hover:scale-110 active:scale-95 shadow-sm",
            model.auto_run_enabled
              ? "bg-amber-500/90 text-white hover:bg-amber-600"
              : "bg-green-500/90 text-white hover:bg-green-600"
          )}
        >
          {model.auto_run_enabled ? "暂停" : "启动"}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(model);
          }}
          className="rounded-lg bg-neutral-800/90 px-2.5 py-1.5 text-[10px] font-semibold text-white transition-all duration-300 hover:scale-110 hover:bg-neutral-900 active:scale-95 shadow-sm"
        >
          删除
        </button>
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
}) {
  const isEdit = mode === "edit";
  const templateOptions = promptTemplates || [];
  const isCustom =
    !formState.prompt_template_id || formState.prompt_template_id === CUSTOM_TEMPLATE_VALUE;
  const selectedTemplate = !isCustom
    ? templateOptions.find((tpl) => tpl.id === formState.prompt_template_id)
    : null;
  const iconSelectValue = useMemo(() => {
    const current = formState.display_icon?.trim();
    if (!current) return CUSTOM_ICON_VALUE;
    return MODEL_ICON_CHOICES.some((option) => option.value === current)
      ? current
      : CUSTOM_ICON_VALUE;
  }, [formState.display_icon]);

  useEffect(() => {
    if (!isCustom && selectedTemplate) {
      onChange((prev) => ({
        ...prev,
        system_prompt: selectedTemplate.system_prompt ?? "",
        user_prompt: selectedTemplate.user_prompt ?? "",
      }));
    }
  }, [isCustom, selectedTemplate, onChange]);

  const handleTemplateChange = (event) => {
    const nextValue = event.target.value;
    if (!nextValue) return;
    if (nextValue === CUSTOM_TEMPLATE_VALUE) {
      onChange({ ...formState, prompt_template_id: CUSTOM_TEMPLATE_VALUE });
      return;
    }
    const template = templateOptions.find((tpl) => tpl.id === nextValue);
    onChange({
      ...formState,
      prompt_template_id: nextValue,
      system_prompt: template?.system_prompt ?? "",
      user_prompt: template?.user_prompt ?? "",
    });
  };

  const handleCustomIconChange = (event) => {
    const trimmed = event.target.value.trim().slice(0, 4);
    onChange({
      ...formState,
      display_icon: trimmed || DEFAULT_MODEL_ICON,
    });
  };

  return (
    <div className="relative w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            {isEdit ? "编辑模型" : "新增模型"}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            选择提示词模板并配置连接信息，启用后系统会按周期自动请求模型。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
        >
          取消
        </button>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          <span>显示名称</span>
          <input
            required
            value={formState.display_name}
            onChange={(event) => onChange({ ...formState, display_name: event.target.value })}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            placeholder="DeepSeek 策略模型"
          />
        </label>

        <div className="flex flex-col gap-2 text-xs font-medium text-neutral-500">
          <span>模型图标</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MODEL_ICON_CHOICES.map((option) => {
              const selected = formState.display_icon === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ ...formState, display_icon: option.value })}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-semibold transition ${
                    selected
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-emerald-200"
                  }`}
                >
                  <img src={option.src} alt={option.label} className="h-6 w-6 rounded-full object-contain" />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onChange({ ...formState, display_icon: "" })}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-semibold transition ${
                iconSelectValue === CUSTOM_ICON_VALUE
                  ? "border-blue-400 bg-blue-50 text-blue-700 shadow-sm"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-blue-200"
              }`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                [EDIT]️
              </span>
              <span>自定义</span>
            </button>
          </div>
          {iconSelectValue === CUSTOM_ICON_VALUE && (
            <input
              value={formState.display_icon ?? ""}
              onChange={handleCustomIconChange}
              maxLength={6}
              className="rounded-lg border border-dashed border-blue-300 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="输入任意 Emoji / 文本"
            />
          )}
          <span className="text-[11px] text-neutral-400">
            当前预览：
            <span className="ml-2 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-2 py-1">
              <ModelAvatar icon={formState.display_icon} size="sm" />
              <span className="text-neutral-500">{formState.display_name || "模型"}</span>
            </span>
          </span>
        </div>

        <p className="text-[11px] text-neutral-400">
          该图标会显示在首页曲线与卡片中，用于快速区分不同模型。
        </p>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          <span>API Base URL</span>
          <input
            value={formState.api_base_url}
            onChange={(event) => onChange({ ...formState, api_base_url: event.target.value })}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            placeholder="https://api.deepseek.com/v1"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          <span>API Key</span>
          <input
            type="password"
            value={formState.api_key}
            onChange={(event) => onChange({ ...formState, api_key: event.target.value })}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            placeholder="sk-..."
          />
          <p className="text-[11px] text-neutral-400">保存后不会再次显示，更新时需重新输入。</p>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          <span>提示词模板</span>
          <select
            value={isCustom ? CUSTOM_TEMPLATE_VALUE : formState.prompt_template_id || ""}
            onChange={handleTemplateChange}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            {templateOptions.length === 0 ? (
              <option value={CUSTOM_TEMPLATE_VALUE}>暂未配置模板</option>
            ) : (
              templateOptions.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.template_name}
                  {template.is_default ? "（默认）" : ""}
                </option>
              ))
            )}
            <option value={CUSTOM_TEMPLATE_VALUE}>不绑定模板（手动编辑）</option>
          </select>
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={formState.human_review_required}
            onChange={(event) => onChange({ ...formState, human_review_required: event.target.checked })}
            className="h-4 w-4 rounded border-neutral-400 text-emerald-500 focus:ring-emerald-400"
          />
          <span>执行前需要人工审核</span>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          <span>自动执行周期（分钟）</span>
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
            className="w-32 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-neutral-900 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ModelsPage() {
  const { data, error, isLoading, mutate } = useSWR("/api/models?includeSecrets=false", fetcher);
  const models = useMemo(
    () => (data?.models ?? []).filter((model) => model.model_id !== "btc_benchmark"),
    [data]
  );

  const {
    data: templateData,
    error: templateError,
    isLoading: templatesLoading,
    mutate: mutateTemplates,
  } = useSWR("/api/prompt-templates?includeContent=true", fetcher);

  const { data: placeholderData } = useSWR("/api/prompt-placeholders", fetcher);

  const promptTemplates = useMemo(() => templateData?.templates ?? [], [templateData]);
  const defaultTemplateId = useMemo(() => {
    return promptTemplates.find((tpl) => tpl.is_default)?.id || promptTemplates[0]?.id || null;
  }, [promptTemplates]);

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

  const closeModal = () => {
    setModalState({ open: false, mode: "create" });
    setFormState(EMPTY_FORM);
    setEditingId(null);
    setSaving(false);
  };

  const hydrateFormFromTemplate = (templateId) => {
    if (!templateId) {
      return {
        prompt_template_id: CUSTOM_TEMPLATE_VALUE,
        system_prompt: "",
        user_prompt: "",
      };
    }
    const template = promptTemplates.find((tpl) => tpl.id === templateId);
    return {
      prompt_template_id: template?.id || CUSTOM_TEMPLATE_VALUE,
      system_prompt: template?.system_prompt || "",
      user_prompt: template?.user_prompt || "",
    };
  };

  const openCreate = () => {
    const templateId = defaultTemplateId || CUSTOM_TEMPLATE_VALUE;
    setModalState({ open: true, mode: "create" });
    setFormState({
      ...EMPTY_FORM,
      ...hydrateFormFromTemplate(templateId),
    });
    setEditingId(null);
    setErrorMessage(null);
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
      api_key: "",
      human_review_required: Boolean(model.human_review_required),
      auto_run_enabled: Boolean(model.auto_run_enabled),
      auto_run_interval_minutes: model.auto_run_interval_minutes || 5,
      prompt_template_id: model.prompt_template_id || CUSTOM_TEMPLATE_VALUE,
      system_prompt: model.system_prompt || "",
      user_prompt: model.user_prompt || "",
      display_icon: model.display_icon || DEFAULT_MODEL_ICON,
    });
    setEditingId(model.model_id);
    setErrorMessage(null);
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

    const payload = {
      display_name: displayName,
      api_base_url: formState.api_base_url.trim() || null,
      human_review_required: formState.human_review_required,
      auto_run_enabled: formState.auto_run_enabled,
      auto_run_interval_minutes: formState.auto_run_interval_minutes,
      display_icon: formState.display_icon || DEFAULT_MODEL_ICON,
    };

    if (formState.api_key.trim()) {
      payload.api_key = formState.api_key.trim();
    }

    if (formState.prompt_template_id && formState.prompt_template_id !== CUSTOM_TEMPLATE_VALUE) {
      payload.prompt_template_id = formState.prompt_template_id;
    } else {
      payload.prompt_template_id = null;
      payload.system_prompt = formState.system_prompt;
      payload.user_prompt = formState.user_prompt;
    }

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

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* 顶部导航栏 - 优化配色和动画 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-white hover:text-slate-900"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7 7-7M3 12h18" />
            </svg>
            返回主界面
          </Link>
          <div className="inline-flex rounded-full bg-gradient-to-br from-slate-100 to-slate-50 p-1.5 text-sm font-semibold shadow-lg shadow-slate-200/50 ring-1 ring-slate-200/50">
          <button
            type="button"
            onClick={() => setTab("models")}
            className={clsx(
              "rounded-full px-6 py-2 transition-all duration-300 ease-out",
              tab === "models"
                ? "bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30 scale-105"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              模型管理
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab("prompts")}
            className={clsx(
              "rounded-full px-6 py-2 transition-all duration-300 ease-out",
              tab === "prompts"
                ? "bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-lg shadow-purple-500/30 scale-105"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              提示词管理
            </span>
          </button>
        </div>
        </div>
        {tab === "models" ? (
          <button
            type="button"
            onClick={openCreate}
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-emerald-500/40 focus:outline-none focus:ring-4 focus:ring-emerald-200 active:scale-95"
          >
            <svg className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增模型
          </button>
        ) : (
          <button
            type="button"
            onClick={openCreateTemplate}
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-emerald-500/40 focus:outline-none focus:ring-4 focus:ring-emerald-200 active:scale-95"
          >
            <svg className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          placeholders={placeholderData?.placeholders ?? []}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={closeModal} />
          <FormModal
            formState={formState}
            onChange={setFormState}
            onClose={closeModal}
            onSubmit={handleSubmit}
            mode={modalState.mode}
            saving={saving}
            promptTemplates={promptTemplates}
          />
        </div>
      ) : null}
    </div>
  );
}



