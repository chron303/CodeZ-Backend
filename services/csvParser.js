// backend/services/csvParser.js
//
// Parses CSV or Excel files into a clean, standardized format.
//
// Flexible column detection — any of these names work:
//   Problem title : "title", "problem", "question", "name", "problem name"
//   Topic         : "topic", "category", "tag", "section"
//   Difficulty    : "difficulty", "level"
//   Solved status : "solved", "status", "done", "completed"
//
// Standardized output per topic:
//   { topic, total, solved, percentage, problems: [...] }

const Papa = require('papaparse');
const XLSX = require('xlsx');
const fs   = require('fs');

// Maps shorthand → canonical display name
const TOPIC_ALIASES = {
  'array': 'Arrays', 'arrays': 'Arrays',
  'string': 'Strings', 'strings': 'Strings',
  'linked list': 'Linked Lists', 'linkedlist': 'Linked Lists', 'linked-list': 'Linked Lists',
  'tree': 'Trees', 'trees': 'Trees', 'binary tree': 'Trees',
  'graph': 'Graphs', 'graphs': 'Graphs',
  'dp': 'Dynamic Programming', 'dynamic programming': 'Dynamic Programming',
  'recursion': 'Recursion', 'backtracking': 'Backtracking',
  'sorting': 'Sorting', 'searching': 'Searching',
  'binary search': 'Binary Search', 'binarysearch': 'Binary Search',
  'heap': 'Heaps', 'heaps': 'Heaps', 'priority queue': 'Heaps',
  'stack': 'Stacks', 'stacks': 'Stacks',
  'queue': 'Queues', 'queues': 'Queues',
  'hash': 'Hashing', 'hashing': 'Hashing', 'hash map': 'Hashing',
  'hashmap': 'Hashing', 'hash table': 'Hashing',
  'two pointers': 'Two Pointers', 'two-pointers': 'Two Pointers',
  'sliding window': 'Sliding Window',
  'greedy': 'Greedy',
  'trie': 'Tries', 'tries': 'Tries',
  'bit manipulation': 'Bit Manipulation', 'bits': 'Bit Manipulation',
  'math': 'Math', 'maths': 'Math', 'mathematics': 'Math',
};

const DIFFICULTY_ALIASES = {
  'easy': 'Easy',   'e': 'Easy',   '1': 'Easy',
  'medium': 'Medium', 'm': 'Medium', '2': 'Medium',
  'hard': 'Hard',   'h': 'Hard',   '3': 'Hard',
};

// Returns the first header key that matches any candidate (case-insensitive)
function findColumn(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lower.findIndex(h => h === candidate || h.includes(candidate));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function toTitleCase(str) {
  if (!str) return '';
  return str.trim().replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function buildColumnMap(headers) {
  const colMap = {
    title:      findColumn(headers, ['title', 'problem', 'question', 'name', 'problem name', 'problem_name']),
    topic:      findColumn(headers, ['topic', 'category', 'tag', 'section', 'type', 'subject']),
    difficulty: findColumn(headers, ['difficulty', 'level', 'diff']),
    solved:     findColumn(headers, ['solved', 'status', 'done', 'completed', 'finished']),
    url:        findColumn(headers, ['url', 'link', 'href', 'leetcode']),
  };

  if (!colMap.title) {
    throw new Error(
      `No title column found. Looked for: title, problem, question, name.\nYour columns: ${headers.join(', ')}`
    );
  }

  return colMap;
}

function parseRow(row, colMap, index) {
  const get = (key) => (key && row[key] != null ? String(row[key]).trim() : '');

  const title = get(colMap.title);
  if (!title) return null; // skip blank rows

  const rawTopic      = get(colMap.topic).toLowerCase();
  const rawDifficulty = get(colMap.difficulty).toLowerCase();
  const rawSolved     = get(colMap.solved).toLowerCase();

  return {
    id: index + 1,
    title,
    topic:      TOPIC_ALIASES[rawTopic] || toTitleCase(rawTopic) || 'General',
    difficulty: DIFFICULTY_ALIASES[rawDifficulty] || 'Easy',
    url:        get(colMap.url),
    solved:     ['true', 'yes', '1', 'done', 'solved', 'complete', 'completed'].includes(rawSolved),
  };
}

function processRows(rows) {
  if (!rows || rows.length === 0) throw new Error('The file has no data rows.');

  const headers = Object.keys(rows[0]);
  const colMap  = buildColumnMap(headers);

  const problems = rows.map((row, i) => parseRow(row, colMap, i)).filter(Boolean);

  if (problems.length === 0) throw new Error('No valid problem rows found. Check that the title column is not empty.');

  // Group by topic — standardized shape: { topic, total, solved, percentage, problems }
  const topicMap = {};
  for (const problem of problems) {
    if (!topicMap[problem.topic]) {
      topicMap[problem.topic] = { topic: problem.topic, total: 0, solved: 0, percentage: 0, problems: [] };
    }
    topicMap[problem.topic].total++;
    if (problem.solved) topicMap[problem.topic].solved++;
    topicMap[problem.topic].problems.push(problem);
  }

  for (const t of Object.values(topicMap)) {
    t.percentage = Math.round((t.solved / t.total) * 100);
  }

  const topics = Object.values(topicMap).sort((a, b) => a.topic.localeCompare(b.topic));
  return { problems, topics };
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const { data, errors } = Papa.parse(content, { header: true, skipEmptyLines: true });
  const fatal = errors.filter(e => e.type === 'Delimiter');
  if (fatal.length > 0) throw new Error('Could not parse CSV: ' + fatal[0].message);
  return processRows(data);
}

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  return processRows(rows);
}

function parseFile(filePath, mimeType) {
  const isExcel = (mimeType && mimeType.includes('spreadsheet')) || filePath.endsWith('.xlsx') || filePath.endsWith('.xls');
  return isExcel ? parseExcel(filePath) : parseCSV(filePath);
}

module.exports = { parseFile };