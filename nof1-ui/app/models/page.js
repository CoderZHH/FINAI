"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

const fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
};

const EMPTY_FORM = {
  display_name: "",
  api_base_url: "",
  api_key: "",
  system_prompt: "",
  user_prompt: "",
  human_review_required: false,
};

function formatDate(timestamp) {
  if (!timestamp) return "尚未更新";
  try {
    return new Date(timestamp).toLocaleString();
  } catch (err) {
    console.warn("Failed to format date", err);
    return "尚未更新";
  }
}

function truncate(text, max = 140) {
  if (!text) return "（未设置）";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function ModelCard({ model, onView, onEdit, onDelete }) {
  return (
    <div
      onClick={() => onView(model)}
      className="group relative overflow-hidden rounded-2xl border border-neutral-200 bg-white/90 p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-xl"
    >
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-emerald-100/60 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-neutral-900">
              {model.display_name || model.model_id}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                model.human_review_required
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-600"
              }`}
            >
              {model.human_review_required ? "需人工审核" : "自动执行"}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">{model.model_id}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(model);
            }}
            className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition hover:border-emerald-200 hover:text-emerald-600"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(model);
            }}
            className="rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
          >
            删除
          </button>
        </div>
      </div>

      <dl className="mt-4 space-y-3 text-sm text-neutral-600">
        <div>
          <dt className="text-xs font-medium text-neutral-400">API Base</dt>
          <dd>{model.api_base_url || "（未配置）"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-neutral-400">系统提示词</dt>
          <dd className="max-h-14 overflow-hidden text-ellipsis whitespace-pre-line leading-relaxed">
            {truncate(model.system_prompt)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-neutral-400">用户提示词</dt>
          <dd className="max-h-14 overflow-hidden text-ellipsis whitespace-pre-line leading-relaxed">
            {truncate(model.user_prompt)}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex items-center justify-between text-xs text-neutral-400">
        <span>{model.has_api_key ? "API Key 已配置" : "API Key 未配置"}</span>
        <span>更新于 {formatDate(model.updated_at)}</span>
      </div>
    </div>
  );
}

function ViewModal({ model, onClose, onStartEdit, onDelete }) {
  if (!model) return null;
  return (
    <div className="relative w-full max-w-3xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">{model.display_name}</h2>
          <p className="mt-1 text-xs text-neutral-500">模型 ID：{model.model_id}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onStartEdit}
            className="rounded-full border border-neutral-200 bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            编辑
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-rose-200 bg-white px-4 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
          >
            删除
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
          >
            关闭
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="rounded-xl bg-neutral-50 p-4">
          <h3 className="text-sm font-semibold text-neutral-500">连接信息</h3>
          <dl className="mt-3 space-y-2 text-sm text-neutral-700">
            <div>
              <dt className="text-xs text-neutral-400">API Base URL</dt>
              <dd>{model.api_base_url || "（未配置）"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400">API Key</dt>
              <dd>{model.has_api_key ? "已保存在服务器" : "未设置"}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400">执行方式</dt>
              <dd>{model.human_review_required ? "需人工审核" : "自动执行"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl bg-neutral-50 p-4">
          <h3 className="text-sm font-semibold text-neutral-500">元数据</h3>
          <dl className="mt-3 space-y-2 text-sm text-neutral-700">
            <div>
              <dt className="text-xs text-neutral-400">模型 ID</dt>
              <dd className="font-mono text-xs text-neutral-500">{model.model_id}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400">创建时间</dt>
              <dd>{formatDate(model.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400">最近更新</dt>
              <dd>{formatDate(model.updated_at)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-500">系统提示词</h3>
          <p className="mt-2 whitespace-pre-wrap rounded-xl border border-neutral-200 bg-white p-3 text-sm leading-relaxed text-neutral-700">
            {model.system_prompt || "（未设置）"}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-neutral-500">用户提示词</h3>
          <p className="mt-2 whitespace-pre-wrap rounded-xl border border-neutral-200 bg-white p-3 text-sm leading-relaxed text-neutral-700">
            {model.user_prompt || "（未设置）"}
          </p>
        </div>
      </div>
    </div>
  );
}

function FormModal({
  mode,
  formState,
  hasApiKey,
  currentModelId,
  onChange,
  onClose,
  onSubmit,
  saving,
}) {
  const isEdit = mode === "edit";

  return (
    <div className="relative w-full max-w-3xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-neutral-900">
            {isEdit ? "编辑模型" : "新增模型"}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            配置连接信息与提示词，保存后即可在右侧面板中使用。
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
        {isEdit ? (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            模型 ID：{" "}
            <span className="font-mono text-neutral-500">
              {currentModelId ?? "（未知）"}
            </span>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
            保存后系统会自动生成模型 ID。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            <span>显示名称</span>
            <input
              required
              value={formState.display_name}
              onChange={(event) =>
                onChange({ ...formState, display_name: event.target.value })
              }
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              placeholder="DeepSeek 策略模型"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            <span>API Base URL</span>
            <input
              value={formState.api_base_url}
              onChange={(event) =>
                onChange({ ...formState, api_base_url: event.target.value })
              }
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              placeholder="https://api.deepseek.com/v1"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            <span>API Key</span>
            <input
              type="password"
              value={formState.api_key}
              onChange={(event) =>
                onChange({ ...formState, api_key: event.target.value })
              }
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              placeholder={isEdit && hasApiKey ? "留空则保持不变" : "sk-..."}
            />
            {isEdit && hasApiKey ? (
              <span className="text-[11px] text-neutral-400">
                已存储密钥。留空将继续沿用原值，如需更新请输入新密钥。
              </span>
            ) : null}
          </label>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={formState.human_review_required}
            onChange={(event) =>
              onChange({
                ...formState,
                human_review_required: event.target.checked,
              })
            }
            className="h-4 w-4 rounded border-neutral-400 text-emerald-500 focus:ring-emerald-400"
          />
          <span>执行前需要人工审批（适用于高风险策略）</span>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          <span>系统提示词（System Prompt）</span>
          <textarea
            rows={4}
            value={formState.system_prompt}
            onChange={(event) =>
              onChange({ ...formState, system_prompt: event.target.value })
            }
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            placeholder="你是一名负责数字资产策略的模型，经常性地复盘市场、管理持仓..."
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          <span>用户提示词（User Prompt）</span>
          <textarea
            rows={4}
            value={formState.user_prompt}
            onChange={(event) =>
              onChange({ ...formState, user_prompt: event.target.value })
            }
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            placeholder="请输出对 BTC、ETH 等资产的策略建议..."
          />
        </label>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-neutral-900 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {saving ? "保存中..." : "保存模型"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ModelsPage() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/models?includeSecrets=false",
    fetcher
  );
  const models = useMemo(() => data?.models ?? [], [data]);

  const [modalState, setModalState] = useState({
    open: false,
    mode: "create",
    model: null,
  });
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const closeModal = () => {
    setModalState({ open: false, mode: "create", model: null });
    setFormState(EMPTY_FORM);
    setEditingId(null);
    setSaving(false);
  };

  const openCreate = () => {
    setModalState({ open: true, mode: "create", model: null });
    setFormState(EMPTY_FORM);
    setErrorMessage(null);
    setFeedback(null);
    setEditingId(null);
  };

  const openView = (model) => {
    console.log("[models] openView", model);
    setModalState({ open: true, mode: "view", model });
    setFormState({
      display_name: model.display_name,
      api_base_url: model.api_base_url || "",
      api_key: "",
      system_prompt: model.system_prompt || "",
      user_prompt: model.user_prompt || "",
      human_review_required: Boolean(model.human_review_required),
    });
    setErrorMessage(null);
    setFeedback(null);
    setEditingId(model.model_id);
  };

  const openEdit = (model) => {
    console.log("[models] openEdit", model);
    setModalState({ open: true, mode: "edit", model });
    setFormState({
      display_name: model.display_name,
      api_base_url: model.api_base_url || "",
      api_key: "",
      system_prompt: model.system_prompt || "",
      user_prompt: model.user_prompt || "",
      human_review_required: Boolean(model.human_review_required),
    });
    setErrorMessage(null);
    setFeedback(null);
    setEditingId(model.model_id);
  };

  const startEditFromView = () => {
    if (!modalState.model) return;
    openEdit(modalState.model);
  };

  const handleDelete = async (model) => {
    if (
      !window.confirm(
        `确定要删除模型「${model.display_name || model.model_id}」吗？此操作会清空其运行时数据。`
      )
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/models/${model.model_id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "删除失败");
      }
      await mutate();
      setFeedback(`模型 ${model.display_name || model.model_id} 已删除。`);
      if (modalState.open && modalState.model?.model_id === model.model_id) {
        closeModal();
      }
    } catch (err) {
      console.error("Failed to delete model", err);
      setErrorMessage(
        err instanceof Error ? err.message : "删除失败，请查看控制台获得更多信息。"
      );
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage(null);

    const isEdit = modalState.mode === "edit";
    const targetModelId = isEdit ? editingId : null;

    console.log("[models] handleSubmit:init", {
      isEdit,
      targetModelId,
      editingId,
      modalStateModel: modalState.model,
      formState,
    });

    if (isEdit && !targetModelId) {
      setErrorMessage("找不到要更新的模型，请刷新页面后重试。");
      setSaving(false);
      return;
    }

    const displayName = (formState.display_name || "").trim();
    const baseUrl = (formState.api_base_url || "").trim();
    const apiKey = (formState.api_key || "").trim();

    const payload = {
      display_name: displayName,
      api_base_url: baseUrl,
      api_key: apiKey,
      system_prompt: formState.system_prompt,
      user_prompt: formState.user_prompt,
      human_review_required: formState.human_review_required,
    };

    if (!displayName) {
      setErrorMessage("显示名称不能为空。");
      setSaving(false);
      return;
    }

    if (!baseUrl) {
      payload.api_base_url = null;
    }
    if (!apiKey) {
      delete payload.api_key;
    }

    try {
      const method = isEdit ? "PUT" : "POST";
      const endpoint = isEdit ? `/api/models/${targetModelId}` : "/api/models";

      console.log("[models] handleSubmit:request", {
        method,
        endpoint,
        payload,
        targetModelId,
        editingId,
      });

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      console.log("[models] handleSubmit:responseMeta", {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        console.log("[models] handleSubmit:responseBody", result);
        throw new Error(result.error || "保存失败");
      }

      await mutate();
      setFeedback(isEdit ? "模型已更新。" : "模型已创建。");
      closeModal();
    } catch (err) {
      console.error("Failed to save model", err);
      setErrorMessage(
        err instanceof Error ? err.message : "保存失败，请重试。"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">模型管理</h1>
          <p className="mt-1 text-sm text-neutral-500">
            维护策略执行所需的大模型配置。支持自定义 API Key、提示词和执行方式。
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:ring-offset-2"
        >
          新增模型
        </button>
      </div>

      {feedback ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {feedback}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {errorMessage}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          模型列表加载失败，请刷新页面重试。
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-dashed border-neutral-200 p-6 text-sm text-neutral-500">
          正在加载模型列表...
        </div>
      ) : null}

      {!isLoading && models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-200 p-10 text-center text-sm text-neutral-500">
          还没有模型配置，点击右上角的「新增模型」按钮创建一个吧。
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {models.map((model) => (
          <ModelCard
            key={model.model_id}
            model={model}
            onView={openView}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {modalState.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
            onClick={closeModal}
          />
          {modalState.mode === "view" ? (
            <ViewModal
              model={modalState.model}
              onClose={closeModal}
              onStartEdit={startEditFromView}
              onDelete={() => modalState.model && handleDelete(modalState.model)}
            />
          ) : (
          <FormModal
            mode={modalState.mode}
            formState={formState}
            hasApiKey={Boolean(modalState.model?.has_api_key)}
            currentModelId={editingId}
            onChange={setFormState}
            onClose={closeModal}
            onSubmit={handleSubmit}
            saving={saving}
          />
          )}
        </div>
      ) : null}
    </div>
  );
}
