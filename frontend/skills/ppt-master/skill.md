---
name: ppt-master
description: >
  AI 驱动的多格式 SVG 内容生成系统。可将源文档（PDF/DOCX/URL/Markdown）
  通过多角色协作转换为高质量 SVG 页面，并导出为 PPTX。当用户要求
  “创建 PPT”、“制作演示文稿”、“生成PPT”、“做PPT”，或提到 “ppt-master” 时使用。
---

# PPT Master Skill

> AI 驱动的多格式 SVG 内容生成系统。通过多角色协作将源文档转换为高质量 SVG 页面，并导出为 PPTX。

**核心流水线**：`源文档 -> 创建项目 -> 模板选项 -> 策略师 -> [图像生成器] -> 执行器 -> 后处理 -> 导出`

> [!CAUTION]
> ## 全局执行纪律（强制）
>
> **本工作流是严格串行流水线。以下规则具有最高优先级，违反任意一条都视为执行失败：**
>
> 1. **串行执行**：步骤必须按顺序执行；每一步的输出都是下一步的输入。非阻塞的相邻步骤在满足前置条件后可以连续推进，不需要等待用户说“继续”。
> 2. **阻塞 = 硬停止**：标记为 **BLOCKING** 的步骤必须完全停止；AI 必须等待用户明确回复后才能继续，且不得替用户做决定。
> 3. **禁止跨阶段打包**：严禁把多个阶段混在一起执行。（注意：第 4 步的“八项确认”是 **BLOCKING**，AI 必须先给出建议并等待用户明确确认后，才能输出设计规范。用户确认后，后续所有非阻塞步骤，如设计规范输出、SVG 生成、演讲备注和后处理，可以自动继续，无需再次确认。）
> 4. **进入前先过闸门**：每个步骤顶部列出的前置条件（GATE）必须在进入该步骤前核验。
> 5. **禁止预先生成**：严禁为后续步骤“提前准备”内容，例如在策略师阶段就编写 SVG 代码。
> 6. **禁止子代理生成 SVG**：执行器第 6 步的 SVG 生成依赖完整上下文，必须由当前主代理端到端完成。禁止把页面 SVG 生成委托给子代理。
> 7. **只能逐页顺序生成**：在执行器第 6 步中，全局设计上下文确认后，SVG 页面必须在同一连续流程中逐页顺序生成。禁止按组批量生成，例如一次 5 页。
> 8. **每页重新读取 SPEC_LOCK**：生成每一页 SVG 前，执行器必须读取 `<project_path>/spec_lock.md`。所有颜色、字体、图标、图片都必须来自该文件，不得凭记忆使用或临时编造。执行器还必须查找当前页面的 `page_rhythm` 标签，并应用匹配的布局纪律（`anchor` / `dense` / `breathing`，见 `executor-base.md` 第 2.1 节）。该规则用于抵抗长 deck 中的上下文压缩漂移，并避免所有页面都变成统一卡片网格。

> [!IMPORTANT]
> ## 语言与沟通规则
>
> - **回复语言**：匹配用户输入和源材料语言。用户显式指定语言时（例如“请用英文回答”）优先遵循用户要求。
> - **模板格式**：无论对话语言是什么，`design_spec.md` 都必须保持原始英文模板结构（章节标题、字段名）。字段内容可以使用用户语言。

> [!IMPORTANT]
> ## 与通用编码技能的兼容性
>
> - `ppt-master` 是面向特定仓库的工作流，不是通用应用脚手架。
> - 默认不要创建 `.worktrees/`、`tests/`、分支工作流或通用工程结构。
> - 如果与通用编码技能冲突，除非用户明确另有要求，否则遵循本技能。

## 主流水线脚本

| 脚本 | 用途 |
|--------|---------|
| `${SKILL_DIR}/scripts/source_to_md/pdf_to_md.py` | PDF 转 Markdown |
| `${SKILL_DIR}/scripts/source_to_md/doc_to_md.py` | 文档转 Markdown：DOCX/HTML/EPUB/IPYNB 使用原生 Python；旧格式（.doc/.odt/.rtf/.tex/.rst/.org/.typ）回退到 pandoc |
| `${SKILL_DIR}/scripts/source_to_md/excel_to_md.py` | Excel 工作簿转 Markdown：支持 .xlsx/.xlsm；旧版 .xls 应另存为 .xlsx |
| `${SKILL_DIR}/scripts/source_to_md/ppt_to_md.py` | PowerPoint 转 Markdown |
| `${SKILL_DIR}/scripts/source_to_md/web_to_md.py` | 网页转 Markdown |
| `${SKILL_DIR}/scripts/source_to_md/web_to_md.cjs` | Node.js 回退方案，用于 WeChat / TLS 受阻站点；仅在 `curl_cffi` 不可用时使用。现在 `web_to_md.py` 在安装 `curl_cffi` 后可处理 WeChat |
| `${SKILL_DIR}/scripts/project_manager.py` | 项目初始化 / 校验 / 管理 |
| `${SKILL_DIR}/scripts/analyze_images.py` | 图像分析 |
| `${SKILL_DIR}/scripts/image_gen.py` | AI 图像生成（多提供商） |
| `${SKILL_DIR}/scripts/svg_quality_checker.py` | SVG 质量检查 |
| `${SKILL_DIR}/scripts/total_md_split.py` | 拆分演讲备注 |
| `${SKILL_DIR}/scripts/finalize_svg.py` | SVG 后处理（统一入口） |
| `${SKILL_DIR}/scripts/svg_to_pptx.py` | 导出 PPTX |
| `${SKILL_DIR}/scripts/update_spec.py` | 将 `spec_lock.md` 中的颜色 / font_family 变更传播到所有已生成 SVG |

完整工具文档见 `${SKILL_DIR}/scripts/README.md`。

## 模板索引

| 索引 | 路径 | 用途 |
|-------|------|---------|
| 布局模板 | `${SKILL_DIR}/templates/layouts/layouts_index.json` | 查询可用页面布局模板 |
| 可视化模板 | `${SKILL_DIR}/templates/charts/charts_index.json` | 查询可用可视化 SVG 模板（图表、信息图、图示、框架） |
| 图标库 | `${SKILL_DIR}/templates/icons/` | 见 `${SKILL_DIR}/templates/icons/README.md`；按需用 `ls templates/icons/<library>/ \| grep <keyword>` 搜索图标 |

## 独立工作流

| 工作流 | 路径 | 用途 |
|----------|------|---------|
| `create-template` | `workflows/create-template.md` | 独立模板创建工作流 |
| `verify-charts` | `workflows/verify-charts.md` | 图表坐标校准：如果 deck 包含数据图表，应在 SVG 生成后运行 |

---

## 工作流

### Step 1: 源内容处理

**GATE**：用户已提供源材料（PDF / DOCX / EPUB / URL / Markdown 文件 / 文本描述 / 对话内容，任意形式均可）。

当用户提供非 Markdown 内容时，立即转换：

| 用户提供 | 命令 |
|---------------|---------|
| PDF 文件 | `python3 ${SKILL_DIR}/scripts/source_to_md/pdf_to_md.py <file>` |
| DOCX / Word / Office 文档 | `python3 ${SKILL_DIR}/scripts/source_to_md/doc_to_md.py <file>` |
| XLSX / XLSM / Excel 工作簿 | `python3 ${SKILL_DIR}/scripts/source_to_md/excel_to_md.py <file>` |
| CSV / TSV | 直接作为纯文本表格源读取 |
| PPTX / PowerPoint deck | `python3 ${SKILL_DIR}/scripts/source_to_md/ppt_to_md.py <file>` |
| EPUB / HTML / LaTeX / RST / 其他 | `python3 ${SKILL_DIR}/scripts/source_to_md/doc_to_md.py <file>` |
| 网页链接 | `python3 ${SKILL_DIR}/scripts/source_to_md/web_to_md.py <URL>` |
| WeChat / 高安全站点 | `python3 ${SKILL_DIR}/scripts/source_to_md/web_to_md.py <URL>`（需要 `curl_cffi`；仅当该包不可用时才回退到 `node web_to_md.cjs <URL>`） |
| Markdown | 直接读取 |

**Checkpoint：确认源内容已准备好，进入 Step 2。**

---

### Step 2: 项目初始化

**GATE**：Step 1 已完成；源内容已准备好（Markdown 文件、用户直接提供的文本，或对话中描述的需求都有效）。

```bash
python3 ${SKILL_DIR}/scripts/project_manager.py init <project_name> --format <format>
```

格式选项：`ppt169`（默认）、`ppt43`、`xhs`、`story` 等。完整格式列表见 `references/canvas-formats.md`。

导入源内容（按情况选择）：

| 情况 | 操作 |
|-----------|--------|
| 有源文件（PDF/MD 等） | `python3 ${SKILL_DIR}/scripts/project_manager.py import-sources <project_path> <source_files...> --move` |
| 用户直接在对话中提供文本 | 不需要导入：内容已经在对话上下文中，后续步骤可直接引用 |

> **必须使用 `--move`**（不是 copy）：所有源文件，包括 Step 1 生成的 Markdown、原始 PDF / MD / 图片，都通过 `import-sources --move` 进入 `sources/`。执行后它们不再保留在原位置。中间产物（例如 `_files/`）会自动处理。

**Checkpoint：确认项目结构创建成功，`sources/` 包含全部源文件，转换材料准备完毕。进入 Step 3。**

---

### Step 3: 模板选项

**GATE**：Step 2 已完成；项目目录结构已准备好。

**默认：自由设计。** 直接进入 Step 4。不要查询 `layouts_index.json`。不要询问用户“模板 vs 自由设计”的 A/B 选择。

**模板流程为显式选择。** 只有用户先前消息中出现以下明确触发时才进入模板流程：

1. 点名具体模板（例如“用 mckinsey 模板” / “use the academic_defense template”）
2. 点名能映射到模板的风格 / 品牌参考（例如“McKinsey 那种” / “Google style” / “学术答辩样式”）
3. 询问有哪些模板可用（例如“有哪些模板可以用”）

触发后：读取 `${SKILL_DIR}/templates/layouts/layouts_index.json`，解析匹配项（或在触发 3 时列出选项），并复制：

```bash
cp ${SKILL_DIR}/templates/layouts/<template_name>/*.svg <project_path>/templates/
cp ${SKILL_DIR}/templates/layouts/<template_name>/design_spec.md <project_path>/templates/
cp ${SKILL_DIR}/templates/layouts/<template_name>/*.png <project_path>/images/ 2>/dev/null || true
cp ${SKILL_DIR}/templates/layouts/<template_name>/*.jpg <project_path>/images/ 2>/dev/null || true
```

**软提示（非阻塞）。** 当内容明显强匹配某个现有模板（例如学术答辩、政府报告、McKinsey 风格 deck），且没有触发模板流程时，输出一句提示并继续，不等待用户：

> 注意：模板库中有一个 `<name>` 模板与此场景很匹配。如果你想使用它，告诉我即可；否则我会继续自由设计。

这是提示，不是问题；不要阻塞。弱匹配或不明确时完全跳过。

> 若要创建新的全局模板，请阅读 `workflows/create-template.md`。

**Checkpoint：默认路径无需用户交互，直接进入 Step 4。若模板触发，则先复制模板文件再继续。**

---

### Step 4: 策略师阶段（强制，不能跳过）

**GATE**：Step 3 已完成；已选择默认自由设计路径，或（若触发）模板文件已复制到项目中。

首先读取角色定义：
```
Read references/strategist.md
```

> **强制闸门**：在编写 `design_spec.md` 前，策略师必须读取 `templates/design_spec_reference.md`，并遵循其完整 I-XI 章节结构。见 `strategist.md` 第 1 节。

**八项确认**（完整模板：`templates/design_spec_reference.md`）：

**BLOCKING**：将八项确认作为一组建议呈现，并在输出《设计规范与内容大纲》前等待用户明确确认或修改。这是唯一核心确认点；一旦确认，后续步骤自动推进。

1. 画布格式
2. 页数范围
3. 目标受众
4. 风格目标
5. 配色方案
6. 图标使用方式
7. 字体计划
8. 图片使用方式

如果用户提供了图片，在输出设计规范前运行分析：
```bash
python3 ${SKILL_DIR}/scripts/analyze_images.py <project_path>/images
```

> **图片处理**：永远不要直接读取 / 打开 / 查看图片文件（`.jpg`、`.png` 等）。所有图片信息都来自 `analyze_images.py` 输出或设计规范中的图片资源清单。

**输出**：
- `<project_path>/design_spec.md`：面向人的设计叙述
- `<project_path>/spec_lock.md`：机器可读的执行契约（骨架：`templates/spec_lock_reference.md`）；执行器每页生成前都会重新读取

**Checkpoint：阶段交付完成，自动进入下一步**：
```markdown
## Strategist Phase Complete
- [x] Eight Confirmations completed (user confirmed)
- [x] Design Specification & Content Outline generated
- [x] Execution lock (spec_lock.md) generated
- [ ] **Next**: Auto-proceed to [Image_Generator / Executor] phase
```

---

### Step 5: 图像生成器阶段（条件触发）

**GATE**：Step 4 已完成；设计规范与内容大纲已生成且用户已确认。

> **触发条件**：图片方案包含“AI generation”。否则跳到 Step 6。

读取 `references/image-generator.md`。

1. 从设计规范中提取所有状态为 `Pending` 的图片
2. 生成提示词文档 -> `<project_path>/images/image_prompts.md`
3. 生成图片（推荐 CLI 工具）：
   ```bash
   python3 ${SKILL_DIR}/scripts/image_gen.py "prompt" --aspect_ratio 16:9 --image_size 1K -o <project_path>/images
   ```

**Checkpoint：确认已尝试生成每一行图片，进入 Step 6**：
```markdown
## Image_Generator Phase Complete
- [x] Prompt document created
- [x] Each image: status is either `Generated` (file present in images/) or `Needs-Manual` (reported to user with filename + reason)
- [x] No row remains `Pending`
```

> 图像生成失败时不要停止：遵循 `references/image-generator.md` 第 4.3 节的失败处理规则，重试一次；仍失败则标记为 `Needs-Manual`，向用户报告，并继续 Step 6。

---

### Step 6: 执行器阶段

**GATE**：Step 4（以及触发时的 Step 5）已完成；所有前置交付物已就绪。

根据选定风格读取角色定义：
```
Read references/executor-base.md           # 必需：通用指南
Read references/shared-standards.md        # 必需：SVG/PPT 技术约束
Read references/executor-general.md        # 通用灵活风格
Read references/executor-consultant.md     # 咨询风格
Read references/executor-consultant-top.md # 顶级咨询风格（MBB 水平）
```

> 只读取 executor-base + shared-standards + 一个风格文件。

**设计参数确认（强制）**：在生成第一张 SVG 前，从 spec 输出关键设计参数（画布尺寸、配色方案、字体计划、正文字号）。见 `executor-base.md` 第 2 节。

**每页重新读取 spec_lock（强制）**：在生成每一页 SVG 前，读取 `<project_path>/spec_lock.md`，并只使用其中的颜色 / 字体 / 图标 / 图片。用于抵抗长 deck 中的上下文压缩漂移。见 `executor-base.md` 第 2.1 节。

> **只能主代理执行**：SVG 生成必须留在当前主代理中，因为页面设计依赖完整上游上下文。不要委托给子代理。
> **生成节奏**：逐页顺序生成，一次一页，保持在同一个连续上下文中。不要批量生成（例如一次 5 页）。

**视觉构建阶段**：在一个连续流程中逐页顺序生成 SVG 页面 -> `<project_path>/svg_output/`

**质量检查闸门（强制）**：所有 SVG 完成后、演讲备注之前运行：
```bash
python3 ${SKILL_DIR}/scripts/svg_quality_checker.py <project_path>
```
- 任何 `error`（禁用 SVG 特性、viewBox 不匹配、spec_lock 漂移等）都必须在继续前修复：回到视觉构建，重新生成对应页面，再次运行检查。
- `warning`（低分辨率图片、非 PPT 安全字体尾部等）：容易修复时修复；否则说明并放行。
- 针对 `svg_output/` 运行（不要在 `finalize_svg.py` 后运行，因为 finalize 会重写 SVG 并掩盖违规）。

**逻辑构建阶段**：生成演讲备注 -> `<project_path>/notes/total.md`

**Checkpoint：确认所有 SVG 与备注已完整生成并通过质量检查。直接进入 Step 7 后处理**：
```markdown
## Executor Phase Complete
- [x] All SVGs generated to svg_output/
- [x] svg_quality_checker.py passed (0 errors)
- [x] Speaker notes generated at notes/total.md
```

> **包含图表页？** 如果 deck 包含数据图表（柱状图 / 折线图 / 饼图 / 雷达图等），在 Step 7 前运行独立工作流 [`verify-charts`](workflows/verify-charts.md) 来校准坐标。AI 模型在将数据映射到像素位置时经常产生 10-50 px 误差；verify-charts 可消除这类问题。若没有图表页则跳过。

---

### Step 7: 后处理与导出

**GATE**：Step 6 已完成；所有 SVG 已生成到 `svg_output/`；演讲备注 `notes/total.md` 已生成。

> 逐个运行以下三个子步骤，每一步必须成功完成后才能进入下一步。
> **绝不要**把它们合并到一个代码块或一次 shell 调用中。

标准三命令流水线（对应 `references/shared-standards.md` 第 5 节）：

**Step 7.1**：拆分演讲备注：
```bash
python3 ${SKILL_DIR}/scripts/total_md_split.py <project_path>
```

**Step 7.2**：SVG 后处理（图标嵌入 / 图片裁剪与嵌入 / 文本扁平化 / 圆角矩形转 path）：
```bash
python3 ${SKILL_DIR}/scripts/finalize_svg.py <project_path>
```

**Step 7.3**：导出 PPTX（默认嵌入演讲备注）：
```bash
python3 ${SKILL_DIR}/scripts/svg_to_pptx.py <project_path> -s final
# Output: exports/<project_name>_<timestamp>.pptx + exports/<project_name>_<timestamp>_svg.pptx
```

> **绝不要**用 `cp` 替代 `finalize_svg.py`，finalize 会执行多项关键处理。
> **绝不要**从 `svg_output/` 导出，必须使用 `-s final`（从 `svg_final/` 导出）。
> **绝不要**添加 `--only` 等额外参数。

---

## 角色切换协议

切换角色前，必须先读取对应参考文件。输出标记：

```markdown
## [Role Switch: <Role Name>]
Reading role definition: references/<filename>.md
Current task: <brief description>
```

---

## 参考资源

| 资源 | 路径 |
|----------|------|
| 共享技术约束 | `references/shared-standards.md` |
| 画布格式规范 | `references/canvas-formats.md` |
| 图片布局规范 | `references/image-layout-spec.md` |
| SVG 图片嵌入 | `references/svg-image-embedding.md` |
| 图标库 | `templates/icons/README.md` |

---

## 备注

- 本地预览：`python3 -m http.server -d <project_path>/svg_final 8000`
- **故障排查**：生成问题（布局溢出、导出错误、空白图片等）请查看 `docs/faq.md` 中的已知解决方案。
