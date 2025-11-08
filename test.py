import os
import json
import time
import re
from datetime import datetime
from openai import OpenAI


# ========= 1. 配置 DeepSeek API =========
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-fa6b76e50a3345519295effe0ec70900")

client = OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url="https://api.deepseek.com",
)

MODEL_NAME = "deepseek-reasoner"  # 可换成 deepseek-v2, deepseek-chat, deepseek-r1 等


# ========= 2. 系统提示词（System Prompt） =========
SYSTEM_PROMPT = xxx

# ========= 3. 用户提示词模板 =========
def build_user_prompt(
    minutes_since_start: int,
    current_time: datetime,
    num_invocations: int,
    market_state_text: str,
    sharpe_ratio: float,
):
    """
    用用户提示词模板拼接动态数据。
    """
    prompt = xxx
    return prompt.strip()


# ========= 4. JSON 提取辅助函数 =========
def extract_json_from_text(text: str) -> dict:
    """
    从文本中提取 JSON 对象
    
    处理以下情况：
    1. 纯 JSON
    2. Markdown 代码块包裹的 JSON (```json ... ```)
    3. 混合文本中的 JSON
    """
    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    
    # 尝试提取 Markdown 代码块中的 JSON
    markdown_pattern = r'```(?:json)?\s*(\{.*?\})\s*```'
    match = re.search(markdown_pattern, text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    
    # 尝试提取第一个完整的 JSON 对象
    json_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
    match = re.search(json_pattern, text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    
    # 如果都失败，抛出错误并显示原始内容
    raise ValueError(f"无法从响应中提取有效 JSON。")


# ========= 5. 模型调用函数（带计时器） =========
def get_trade_decision(minutes_since_start, current_time, num_invocations, market_state_text, sharpe_ratio):
    """
    调用 DeepSeek API 获取交易决策
    
    返回：
        dict: 包含交易决策的 JSON 对象
        float: API 调用耗时（秒）
    """
    # 开始计时
    start_time = time.time()
    
    print("⏱️  开始调用 DeepSeek API...")
    
    user_prompt = build_user_prompt(
        minutes_since_start=minutes_since_start,
        current_time=current_time,
        num_invocations=num_invocations,
        market_state_text=market_state_text,
        sharpe_ratio=sharpe_ratio,
    )

    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=60000,
        )

        # API 调用完成
        api_time = time.time() - start_time
        print(f"✅ API 调用完成，耗时: {api_time:.2f} 秒\n")

        # 获取响应内容
        content = response.choices[0].message.content
        
        # ============================================================
        # 📄 完整输出 DeepSeek 返回结果（用于调试）
        # ============================================================
        print("=" * 80)
        print("📄 DeepSeek API 完整返回结果：")
        print("=" * 80)
        print(content)
        print("=" * 80)
        print(f"返回内容长度: {len(content)} 字符")
        print(f"返回内容类型: {type(content)}")
        print("=" * 80 + "\n")
        
        # 解析 JSON
        print("🔍 开始解析 JSON...")
        decision = extract_json_from_text(content)
        print("✅ JSON 解析成功\n")
        
        return decision, api_time
        
    except Exception as e:
        elapsed_time = time.time() - start_time
        print(f"❌ 错误发生，已运行: {elapsed_time:.2f} 秒")
        print(f"错误类型: {type(e).__name__}")
        print(f"错误信息: {str(e)}\n")
        raise


# ========= 6. 示例执行（带完整计时） =========
if __name__ == "__main__":
    print("=" * 80)
    print("🚀 AI 交易决策系统启动")
    print("=" * 80 + "\n")
    
    # 总计时器
    total_start = time.time()
    
    # 示例变量定义
    minutes_since_start = 17802
    current_time = "2025-11-03 21:51:04.603908"
    num_invocations = 6634
    sharpe_ratio = 0.359

    # 市场数据
    market_state_text =xxx
    try:
        # 调用模型（包含 API 计时）
        decision, api_time = get_trade_decision(
            minutes_since_start,
            current_time,
            num_invocations,
            market_state_text,
            sharpe_ratio,
        )

        print("=" * 80)
        print("📊 模型返回交易决策 JSON：")
        print("=" * 80)
        print(json.dumps(decision, ensure_ascii=False, indent=2))
        print("=" * 80 + "\n")
        
        print("=" * 80)
        print("🧠 模型的思考过程（justification 字段）")
        print("=" * 80)
        print(decision.get("justification", "无"))
        print("=" * 80 + "\n")
        
        # 总耗时
        total_time = time.time() - total_start
        print("=" * 80)
        print("⏱️  性能统计")
        print("=" * 80)
        print(f"API 调用耗时: {api_time:.2f} 秒")
        print(f"总运行时间: {total_time:.2f} 秒")
        print(f"非 API 耗时: {total_time - api_time:.2f} 秒")
        print("=" * 80)
        
    except Exception as e:
        print("\n" + "=" * 80)
        print("❌ 程序执行失败")
        print("=" * 80)
        print(f"错误类型: {type(e).__name__}")
        print(f"错误信息: {str(e)}")
        total_time = time.time() - total_start
        print(f"⏱️  失败前运行时间: {total_time:.2f} 秒")
        print("=" * 80)
        raise