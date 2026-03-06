import fs from "node:fs/promises";
import path from "node:path";

function stripQuotes(value) {
  if (!value) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

export async function loadEnvFromFile(filePath, options = {}) {
  const { override = true } = options;
  if (!filePath) return;
  const resolvedPath = path.resolve(filePath);
  try {
    const content = await fs.readFile(resolvedPath, "utf8");
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .forEach((line) => {
        if (!line || line.startsWith("#") || line.startsWith("//")) return;
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) return;
        const key = line.slice(0, eqIdx).trim();
        if (!key.length) return;
        const value = stripQuotes(line.slice(eqIdx + 1).trim());
        if (!override && Object.prototype.hasOwnProperty.call(process.env, key)) {
          return;
        }
        process.env[key] = value;
      });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(`[env] 未找到环境文件 ${resolvedPath}，跳过加载。`);
      return;
    }
    console.error(`[env] 读取 ${resolvedPath} 失败:`, error.message);
    throw error;
  }
}
