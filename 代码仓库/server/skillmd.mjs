export function renderSkillMarkdown(skill) {
  const title = skill.title || '图派配方';
  const tags = Array.isArray(skill.tags) ? skill.tags.join(', ') : '';
  const params = skill.params || {};
  const lines = [
    '---',
    `name: ${String(title).replace(/[\r\n]/g, ' ').slice(0, 100)}`,
    `description: 图派（TuPai）出图配方：${String(skill.notes || title).replace(/[\r\n]/g, ' ').slice(0, 200)}。用于把日常照片二次创作为可发布的作品；提示词与参数可直接复用。`,
    '---',
    '',
    `# ${title}`,
    '',
    '把日常照片二次创作为愿意发出去的作品。本技能由图派（TuPai）导出，格式 tupai-skill-v1。',
    '',
    '## 使用方法',
    '',
    '1. 准备一张自己的底图（人物主体清晰；本配方只改环境/光线/风格，不改主体）。',
    '2. 调用图生图模型，传入下方提示词与参数；无底图时按文生图使用。',
    '3. 不满意可再生成 3–5 次；仍不行就换一条候选思路，不要叠加多个改造任务。',
    '',
    '## 提示词',
    '',
    '```text',
    String(skill.prompt || ''),
    '```',
    '',
  ];
  if (skill.negative_prompt) {
    lines.push('## 负面提示词', '', '```text', String(skill.negative_prompt), '```', '');
  }
  lines.push(
    '## 参数',
    '',
    `- 模型：\`${skill.model || 'agnes-image-2.5-flash'}\``,
    `- 画幅比例：\`${params.aspect || params.ratio || '3:4'}\``,
    `- 尺寸档位：\`${params.size || '1K'}\``,
  );
  if (skill.template_id) lines.push(`- 来源模板：\`${skill.template_id}\``);
  if (tags) lines.push(`- 风格标签：${tags}`);
  if (skill.notes) lines.push('', '## 备注', '', String(skill.notes));
  lines.push(
    '',
    '## 边界',
    '',
    '- 保留人物脸部、表情、发型与服装不变；只做环境/光线/风格改造。',
    '- 结果发布时标注「AI 生成」；不公开他人原图。',
    '',
  );
  return lines.join('\n');
}