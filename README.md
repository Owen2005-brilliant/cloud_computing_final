# 跨学科知识图谱智能体（Cloud-Native + LLM Agents）

输入一个核心概念词（如“熵 / 最小二乘法 / 神经网络”），系统会在多个学科域挖掘相关概念，生成结构化知识图谱（JSON），并在 Web 端进行可交互可视化展示。

## 快速开始（Docker 一键启动）

在项目根目录执行：

```bash
docker compose -p xkg up -d --build
```

启动后访问：
- **Web UI**：`http://localhost:5173`
- **Backend API (Swagger)**：`http://localhost:8000/docs`
- **Neo4j Browser**：`http://localhost:7474`（账号 `neo4j` / 密码 `neo4j_password`）


## 使用说明

1. 打开 Web UI，输入概念词（例如 `Entropy` 或 `熵`），点击 Generate
2. 等待 Job 完成后会自动加载图谱
3. 点击节点查看详情与证据；点击 Expand 进行二跳扩展
4. 可导出 JSON

## 项目结构

- `backend/`：FastAPI + Agent Orchestrator + Redis/Neo4j
- `frontend/`：React + ECharts 图谱可视化
- `docker-compose.yml`：一键启动 Redis / Neo4j / backend / frontend

