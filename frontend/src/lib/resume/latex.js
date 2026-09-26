// LaTeX to plain text.
//
// A .tex resume is already text, it just carries markup. Stripping it with a
// focused pass beats pulling in a full LaTeX parser: resumes use a small
// vocabulary of commands, and anything unknown degrades to its argument, which
// is exactly what a skill matcher wants to read.

// Commands whose argument is the visible text, so \textbf{React} -> React.
const KEEP_ARGUMENT = [
  'textbf', 'textit', 'texttt', 'textsc', 'emph', 'underline', 'mbox', 'text',
  'section', 'subsection', 'subsubsection', 'paragraph', 'title', 'heading',
  'resumeItem', 'resumeSubheading', 'cvitem', 'item',
];

// Commands to drop entirely, argument and all.
const DROP_WITH_ARGUMENT = [
  'usepackage', 'documentclass', 'input', 'include', 'includegraphics',
  'hypersetup', 'geometry', 'pagestyle', 'label', 'ref', 'cite', 'vspace',
  'hspace', 'setlength', 'renewcommand', 'newcommand', 'definecolor', 'color',
];

const ACCENTS = {
  '\\&': '&', '\\%': '%', '\\$': '$', '\\#': '#', '\\_': '_',
  '\\{': '{', '\\}': '}', '~': ' ', '\\\\': '\n', '\\ ': ' ',
  '---': '-', '--': '-', '``': '"', "''": '"',
};

export function texToText(source) {
  let text = String(source);

  // Everything before \begin{document} is setup, not resume content.
  const bodyAt = text.indexOf('\\begin{document}');
  if (bodyAt !== -1) text = text.slice(bodyAt + '\\begin{document}'.length);
  text = text.replace(/\\end\{document\}[\s\S]*$/, '');

  // Comments, but not an escaped \% inside a line.
  text = text.replace(/(^|[^\\])%.*$/gm, '$1');

  // \href{url}{label} and \url{...} keep the part a human reads.
  text = text.replace(/\\href\s*\{[^}]*\}\s*\{([^}]*)\}/g, '$1');
  text = text.replace(/\\url\s*\{([^}]*)\}/g, '$1');

  for (const command of DROP_WITH_ARGUMENT) {
    text = text.replace(new RegExp(`\\\\${command}\\s*(\\[[^\\]]*\\])?\\s*\\{[^}]*\\}`, 'g'), '');
    text = text.replace(new RegExp(`\\\\${command}\\s*(\\[[^\\]]*\\])?(?=\\s|$)`, 'g'), '');
  }

  // \begin{itemize} ... \end{itemize} markers, keeping what is between them.
  text = text.replace(/\\(begin|end)\s*\{[^}]*\}(\[[^\]]*\])?/g, '\n');

  // Repeat, because resume templates nest \textbf{\href{..}{..}} several deep.
  for (let pass = 0; pass < 4; pass++) {
    for (const command of KEEP_ARGUMENT) {
      text = text.replace(new RegExp(`\\\\${command}\\s*\\{([^{}]*)\\}`, 'g'), '$1 ');
    }
  }
  // \item with no braces still starts a bullet.
  text = text.replace(/\\item\b/g, '\n- ');

  // Inline and display math rarely holds a skill name; keep it simple.
  text = text.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\$[^$\n]*\$/g, ' ');

  for (const [from, to] of Object.entries(ACCENTS)) text = text.split(from).join(to);

  // Anything left over: a bare command keeps its argument as plain text.
  text = text.replace(/\\[a-zA-Z@]+\s*\{([^{}]*)\}/g, '$1');
  text = text.replace(/\\[a-zA-Z@]+\b/g, '');
  text = text.replace(/[{}]/g, '');

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
