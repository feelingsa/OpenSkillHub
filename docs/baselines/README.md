# 旧首页回归基线

这些文件记录根目录旧 `frontend/` 的卡片交互。它们只用于 M2 迁移比对，正式应用不会在运行时引用根目录 `frontend/`。

| 文件 | 视口 | 记录内容 |
| --- | --- | --- |
| `legacy-home-desktop-1440x900.png` | `1440 x 900` | 深色网格背景、标题和 16 层归档卡片堆叠；由 6 个示例 Skill 循环展示。 |
| `legacy-home-mobile-390x844.png` | `390 x 844` | 现有移动端缩放布局及可见卡片层级。 |
| `home-current-desktop-1440x900.png` | `1440 x 900` | M2 当前 Node 用户端目录截图；以真实扫描的 Skill 数据呈现卡片堆叠、目录筛选和服务状态。 |
| `home-current-desktop-1440x900.json` | `1440 x 900` | 对应截图的 URL、卡片数、焦点卡片数和溢出检查指标。 |

## 已确认交互合同

- 卡片数据为 `ppt-master`、`drawio`、`tencent-meeting-email`、`html-ppt-skill`、`svg-generator`、`xml-diagram` 六项示例；当前实现复制为 16 层视觉栈。
- 在卡片堆叠区域滚轮向上/向下会切换栈偏移，并在 320ms 锁定期内忽略连续滚轮事件。
- 指向非聚焦卡片会抬升该卡，改变其 `transform`、层级、亮度和模糊度；离开区域后恢复。
- 点击可命中卡片会打开 Skill 预览弹窗，读取对应 `skill.md`；点击遮罩或按 `Escape` 关闭。
- 新首页必须保留上述操作语义，但不再循环复制 Skill；实际层数由扫描结果决定。

## 迁移限制

- 这些截图反映旧页面，不覆盖 `node/source/` 中的用户端 SVG 壳层。
- M2 使用真实动态 Skill 数据后，卡片数量、标题和状态文案可以变化；视觉层次、可操作性和 reduced-motion 行为必须由新的截图测试验证。
