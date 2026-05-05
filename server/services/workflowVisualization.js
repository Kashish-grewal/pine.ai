// ================================================================
// WORKFLOW VISUALIZATION SERVICE
// ================================================================
// Generates Mermaid flowchart definitions from meeting data.
// Uses Groq LLM to analyze the meeting flow and produce a diagram.
// ================================================================

const { getGroq } = require('./groqClient');

// ── Node-ID sanitizer ─────────────────────────────────────────────
// Mermaid requires every node to have an alphanumeric ID before its
// shape brackets, e.g.  A[Label]  or  D1{Decision}.
// The LLM sometimes forgets and writes  [Label]  without an ID.
// This function detects those cases and auto-assigns short IDs,
// then rewrites any connection lines to use the new IDs.
// ──────────────────────────────────────────────────────────────────
function fixMissingNodeIds(code) {
  // Matches a node shape that has NO ID prefix:
  //   [text]  {text}  {{text}}  ([text])  [[text]]
  // i.e. the shape opener appears right after whitespace or line-start.
  const bareNodeRe = /(?<=[^\w\])])(\(\[|\[\[|\{\{|\{|\[)([^\]\[{}\(\)\n]+?)(\]\)|\]\]|\}\}|\}|\])(:::\w+)?/g;

  // Also match nodes at the very start of a trimmed line
  const lineStartBareRe = /^(\s*)(\(\[|\[\[|\{\{|\{|\[)([^\]\[{}\(\)\n]+?)(\]\)|\]\]|\}\}|\}|\])(:::\w+)?/;

  const labelToId = new Map(); // label-text → assigned ID
  let counter = 0;

  const genId = (label) => {
    const clean = label.trim();
    if (labelToId.has(clean)) return labelToId.get(clean);
    const id = `N${counter++}`;
    labelToId.set(clean, id);
    return id;
  };

  const isDirective = (t) =>
    !t ||
    t.startsWith('graph') ||
    t.startsWith('flowchart') ||
    t.startsWith('classDef') ||
    t.startsWith('class ') ||
    t.startsWith('%%');

  const lines = code.split('\n');

  // ── Pass 1: collect labels from standalone node lines ─────────
  for (const line of lines) {
    const trimmed = line.trim();
    if (isDirective(trimmed) || trimmed.includes('-->') || trimmed.includes('---')) continue;

    const m = lineStartBareRe.exec(trimmed);
    if (m) {
      genId(m[3]); // register the label → ID mapping
    }
  }

  // Also scan connection lines for bare node shapes so we map their IDs too
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes('-->') && !trimmed.includes('---')) continue;
    for (const m of trimmed.matchAll(bareNodeRe)) {
      genId(m[2]);
    }
  }

  // ── Pass 2: rewrite lines ─────────────────────────────────────
  return lines.map((line) => {
    const trimmed = line.trim();
    if (isDirective(trimmed)) return line;

    const indent = line.match(/^(\s*)/)?.[1] || '';

    // Standalone node definition without ID
    if (!trimmed.includes('-->') && !trimmed.includes('---')) {
      const m = lineStartBareRe.exec(trimmed);
      if (m) {
        const [, , open, label, close, cls = ''] = m;
        const id = genId(label);
        return `${indent}${id}${open}${label}${close}${cls}`;
      }
    }

    // Connection line — replace bare node shapes with their IDs
    if (trimmed.includes('-->') || trimmed.includes('---')) {
      const fixed = trimmed.replace(bareNodeRe, (_, open, label, close, cls = '') => {
        const id = genId(label);
        return id; // connection lines only need the ID
      });
      return `${indent}${fixed}`;
    }

    return line;
  }).join('\n');
}

// ── Color-block injection ─────────────────────────────────────────
const COLOR_BLOCK = [
  '    classDef topic fill:#FF69B4,stroke:#C71585,color:#000,font-weight:bold',
  '    classDef decision fill:#FFD700,stroke:#FF8C00,color:#000,font-weight:bold',
  '    classDef task fill:#00BFFF,stroke:#0047AB,color:#000,font-weight:bold',
  '    classDef milestone fill:#7CFC00,stroke:#228B22,color:#000,font-weight:bold',
].join('\n');

function ensureColors(mermaid) {
  if (mermaid.includes('classDef topic')) return mermaid;
  const firstNewline = mermaid.indexOf('\n');
  return mermaid.slice(0, firstNewline + 1) + COLOR_BLOCK + '\n' + mermaid.slice(firstNewline + 1);
}

// ── Main export ───────────────────────────────────────────────────
const generateMeetingWorkflow = async ({ title, summary, decisions, tasks, segments }) => {
  const topicContext = (segments || [])
    .slice(0, 20)
    .map((s) => `${s.speaker_label}: ${s.text_segment}`)
    .join('\n');

  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  const allTasks = (tasks || []).slice().sort((a, b) =>
    (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
  );
  const totalTaskCount = allTasks.length;
  const topTasks = allTasks.slice(0, 8);

  const taskList = topTasks
    .map((t, i) => `T${i}: [${t.assignee || 'TBD'}] ${(t.description || '').substring(0, 60)}`)
    .join('\n');

  const decisionList = (decisions || [])
    .slice(0, 5)
    .map((d, i) => `D${i}: ${typeof d === 'string' ? d.substring(0, 80) : d}`)
    .join('\n');

  const truncatedSummary = (summary || '').substring(0, 400);

  const prompt = `Generate a Mermaid.js flowchart for this specific meeting. Use REAL content from the meeting data below — no generic placeholders.

MEETING: ${title || 'Untitled Meeting'}
SUMMARY: ${truncatedSummary || 'N/A'}
DECISIONS: ${decisionList || 'None'}
TASKS: ${taskList || 'None'}${totalTaskCount > 8 ? ` (+ ${totalTaskCount - 8} more)` : ''}
TRANSCRIPT: ${topicContext || 'N/A'}

OUTPUT RULES — follow exactly:
1. Start with:  graph TD
2. Copy these classDef lines verbatim on lines 2-5:
   classDef topic fill:#FF69B4,stroke:#C71585,color:#000,font-weight:bold
   classDef decision fill:#FFD700,stroke:#FF8C00,color:#000,font-weight:bold
   classDef task fill:#00BFFF,stroke:#0047AB,color:#000,font-weight:bold
   classDef milestone fill:#7CFC00,stroke:#228B22,color:#000,font-weight:bold
3. EVERY node MUST have a SHORT ALPHANUMERIC ID before its brackets. Examples:
   ✅ CORRECT:   S([Meeting Start]):::milestone
   ✅ CORRECT:   T1[Sprint Review]:::topic
   ✅ CORRECT:   D0{Extend deadline}:::decision
   ✅ CORRECT:   A1{{Alice: Update docs}}:::task
   ❌ WRONG:     [Sprint Review]:::topic        ← missing ID
   ❌ WRONG:     {Extend deadline}:::decision   ← missing ID
4. Node types:
   ([text])  :::milestone  — meeting start and end only
   [text]    :::topic      — discussion topics from transcript
   {text}    :::decision   — decisions from the DECISIONS list above
   {{text}}  :::task       — action items from the TASKS list above
5. Connect with -->  e.g.  S --> T1 --> D0 --> A1
6. Use actual meeting content for every label (decisions, task descriptions, topics)
7. Max 35 chars per label
8. Return ONLY the Mermaid code. No markdown fences. No explanation.

Example output structure (use YOUR meeting content, not these placeholders):
graph TD
    classDef topic fill:#FF69B4,stroke:#C71585,color:#000,font-weight:bold
    classDef decision fill:#FFD700,stroke:#FF8C00,color:#000,font-weight:bold
    classDef task fill:#00BFFF,stroke:#0047AB,color:#000,font-weight:bold
    classDef milestone fill:#7CFC00,stroke:#228B22,color:#000,font-weight:bold
    S([Meeting Start]):::milestone
    T0[Sprint Velocity Review]:::topic
    T1[Roadmap Planning]:::topic
    D0{Extend Sprint by 2 days}:::decision
    D1{Cut feature scope}:::decision
    A0{{Alice: Update timeline}}:::task
    A1{{Bob: Notify stakeholders}}:::task
    E([Meeting End]):::milestone
    S --> T0 --> D0 --> A0
    S --> T1 --> D1 --> A1
    A0 --> E
    A1 --> E`;

  try {
    const response = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.6,
      max_tokens: 1800,
      messages: [
        {
          role: 'system',
          content: 'You generate Mermaid.js flowchart code. CRITICAL: every node MUST have a unique alphanumeric ID before its shape brackets (e.g. A[label], D0{label}, T1{{label}}). Never write a bare [label] without an ID prefix. Return ONLY valid Mermaid syntax, no fences, no explanation.',
        },
        { role: 'user', content: prompt },
      ],
    });

    let mermaid = response.choices[0]?.message?.content || '';

    // Strip markdown fences
    mermaid = mermaid.replace(/```mermaid\n?/gi, '').replace(/```\n?/g, '').trim();

    // Ensure starts with graph/flowchart
    if (!mermaid.startsWith('graph') && !mermaid.startsWith('flowchart')) {
      const graphIdx = mermaid.indexOf('graph');
      const flowIdx  = mermaid.indexOf('flowchart');
      const startIdx = Math.min(
        graphIdx >= 0 ? graphIdx : Infinity,
        flowIdx  >= 0 ? flowIdx  : Infinity
      );
      if (startIdx < Infinity) {
        mermaid = mermaid.substring(startIdx);
      } else {
        return generateFallbackDiagram(title, decisions, tasks);
      }
    }

    // Auto-fix any nodes missing their ID (safety net)
    mermaid = fixMissingNodeIds(mermaid);

    // Ensure color classDefs are present
    mermaid = ensureColors(mermaid);

    return mermaid;
  } catch (err) {
    console.error('[Workflow] LLM generation failed:', err.message);
    return generateFallbackDiagram(title, decisions, tasks);
  }
};

// ── Fallback (when LLM completely fails) ─────────────────────────
function generateFallbackDiagram(title, decisions, tasks) {
  const lines = [
    'graph TD',
    '    classDef topic fill:#FF69B4,stroke:#C71585,color:#000,font-weight:bold',
    '    classDef decision fill:#FFD700,stroke:#FF8C00,color:#000,font-weight:bold',
    '    classDef task fill:#00BFFF,stroke:#0047AB,color:#000,font-weight:bold',
    '    classDef milestone fill:#7CFC00,stroke:#228B22,color:#000,font-weight:bold',
    `    S(["${escMermaid(title || 'Meeting')} Start"]):::milestone`,
  ];

  const decList = (decisions || []).slice(0, 5);
  const taskList = (tasks || []).slice(0, 6);

  if (decList.length > 0) {
    decList.forEach((d, i) => {
      lines.push(`    D${i}{"${escMermaid(String(d).substring(0, 35))}"}:::decision`);
    });
    lines.push('    S --> D0');
    for (let i = 0; i < decList.length - 1; i++) lines.push(`    D${i} --> D${i + 1}`);
  } else {
    lines.push('    D0{No formal decisions}:::decision');
    lines.push('    S --> D0');
  }

  const lastD = `D${Math.max(0, decList.length - 1)}`;
  taskList.forEach((t, i) => {
    const label = `${t.assignee || 'TBD'}: ${(t.description || 'Task').substring(0, 28)}`;
    lines.push(`    T${i}{{"${escMermaid(label)}"}}:::task`);
    lines.push(`    ${lastD} --> T${i}`);
  });

  lines.push('    E(["Meeting Complete"]):::milestone');
  const lastNode = taskList.length > 0 ? `T${taskList.length - 1}` : lastD;
  lines.push(`    ${lastNode} --> E`);

  return lines.join('\n');
}

function escMermaid(str) {
  return (str || '')
    .replace(/"/g, "'")
    .replace(/[[\]{}()#|]/g, '')
    .trim()
    .substring(0, 60);
}

module.exports = { generateMeetingWorkflow };
