# Smart Campus Assistant — Full Project

This repository contains a minimal but production-ready **Smart Campus Assistant**: a web application with a React frontend (Tailwind) and a Node/Express backend that exposes an API and a SQLite campus database. The backend can optionally call OpenAI (or other LLM) to provide conversational responses enriched with structured campus data.

---

## What you get in this single document

- Project architecture & instructions
- All important files (server, DB seed, React app) as copy-pasteable code blocks
- `package.json` and run scripts

> Note: paste files into a local project folder. I kept external dependencies minimal. Replace `process.env.OPENAI_API_KEY` with your key if you want LLM augmentation.

---

## Architecture

```
smart-campus-assistant/
├─ backend/
│  ├─ package.json
│  ├─ server.js
│  ├─ db.js
│  ├─ seed.sql
│  └─ data/ (optional seeded DB file campus.db)
├─ frontend/
│  ├─ package.json
│  ├─ src/
│  │  ├─ App.jsx
│  │  ├─ index.jsx
│  │  ├─ components/Chat.jsx
│  │  └─ styles.css (Tailwind entry)
└─ README.md
```

---

## Backend — `backend/package.json`

```json
{
  "name": "smart-campus-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "seed": "node seed.js"
  },
  "dependencies": {
    "better-sqlite3": "^8.0.0",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2",
    "openai": "^4.0.0",
    "multer": "^1.4.5"
  }
}
```

---

## Backend — `backend/db.js`

```js
// db.js - lightweight sqlite wrapper using better-sqlite3
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'campus.db');
const fs = require('fs');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

const db = new Database(dbPath);

// Initialize tables if not exist
db.exec(`
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY, title TEXT, location TEXT, start DATETIME, end DATETIME, details TEXT
);
CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY, name TEXT, type TEXT, location TEXT, hours TEXT, details TEXT
);
CREATE TABLE IF NOT EXISTS dining (
  id INTEGER PRIMARY KEY, name TEXT, cuisine TEXT, hours TEXT, location TEXT, details TEXT
);
CREATE TABLE IF NOT EXISTS library (
  id INTEGER PRIMARY KEY, title TEXT, author TEXT, call_number TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY, office TEXT, contact TEXT, hours TEXT, details TEXT
);
`);

module.exports = db;
```

---

## Backend — `backend/seed.sql`

```sql
-- seed.sql: small sample rows
INSERT INTO schedules (title, location, start, end, details) VALUES
('Intro to AI - Lecture','Room 101','2025-09-15 10:00','2025-09-15 11:30','Prof. Smith, weekly'),
('Student Council Meeting','Student Center','2025-09-16 16:00','2025-09-16 18:00','Open to all students');

INSERT INTO facilities (name,type,location,hours,details) VALUES
('Swimming Pool','Recreation','Sports Complex','06:00-21:00','Membership required'),
('Gym','Recreation','Sports Complex','05:00-23:00','Free for students');

INSERT INTO dining (name,cuisine,hours,location,details) VALUES
('Campus Cafe','Cafe','08:00-20:00','Central Plaza','Coffee, sandwiches, vegetarian options'),
('North Mess','Cafeteria','07:00-22:00','North Wing','Meal plans accepted');

INSERT INTO library (title,author,call_number,status) VALUES
('Introduction to Algorithms','Cormen','QA76.6 .C66','available'),
('Artificial Intelligence: A Modern Approach','Russell & Norvig','Q335 .R87','checked out');

INSERT INTO admin (office,contact,hours,details) VALUES
('Registrar','registrar@campus.edu','09:00-17:00','Course registration, transcripts'),
('Financial Aid','finaid@campus.edu','09:00-17:00','Scholarship and loan assistance');
```

---

## Backend — `backend/server.js`

```js
// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');
const { Configuration, OpenAIApi } = require('openai');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// optional: OpenAI setup if provided
let openai = null;
if (process.env.OPENAI_API_KEY) {
  const conf = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
  openai = new OpenAIApi(conf);
}

// helper: simple search across tables
function searchTables(query) {
  const q = `%${query}%`;
  const results = {};
  results.schedules = db.prepare("SELECT * FROM schedules WHERE title LIKE ? OR details LIKE ? OR location LIKE ?").all(q,q,q);
  results.facilities = db.prepare("SELECT * FROM facilities WHERE name LIKE ? OR type LIKE ? OR details LIKE ?").all(q,q,q);
  results.dining = db.prepare("SELECT * FROM dining WHERE name LIKE ? OR cuisine LIKE ? OR details LIKE ?").all(q,q,q);
  results.library = db.prepare("SELECT * FROM library WHERE title LIKE ? OR author LIKE ? OR call_number LIKE ?").all(q,q,q);
  results.admin = db.prepare("SELECT * FROM admin WHERE office LIKE ? OR contact LIKE ? OR details LIKE ?").all(q,q,q);
  return results;
}

// endpoint: query the campus DB and optionally ask LLM to craft a friendly reply
app.post('/api/query', async (req, res) => {
  const { message, useLLM } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const hits = searchTables(message);

  // Build a compact context summary
  const summaryParts = [];
  for (const k of Object.keys(hits)) {
    if (hits[k].length > 0) {
      summaryParts.push(`${k.toUpperCase()}: ${hits[k].slice(0,3).map(r => JSON.stringify(r)).join('; ')}`);
    }
  }
  const contextSummary = summaryParts.length ? summaryParts.join('\n') : 'No matching campus records.';

  // If LLM is available and requested, craft a friendly response
  if (useLLM && openai) {
    try {
      const prompt = `You are a helpful campus assistant. The user asked: "${message}". Here are campus records found:\n${contextSummary}\nPlease answer concisely, mention whether records were found, and provide next steps or contact info.`;

      const completion = await openai.createChatCompletion({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'You are a helpful campus assistant.' }, { role: 'user', content: prompt }],
        max_tokens: 400
      });

      const reply = completion.data.choices[0].message.content;
      return res.json({ reply, hits });
    } catch (err) {
      console.error('LLM error', err.message);
      return res.json({ reply: `Found records. ${contextSummary}`, hits });
    }
  }

  // Non-LLM fallback: return structured hits and a simple text summary
  const simpleReply = summaryParts.length ? `I found some items: \n${contextSummary}` : `I couldn't find matching campus records for "${message}". Try different keywords or ask the Registrar.`;
  res.json({ reply: simpleReply, hits });
});

// Admin endpoints: add record (simple examples)
app.post('/api/admin/facilities', (req,res) => {
  const { name, type, location, hours, details } = req.body;
  const stmt = db.prepare('INSERT INTO facilities (name,type,location,hours,details) VALUES (?,?,?,?,?)');
  const info = stmt.run(name, type, location, hours, details);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Simple search endpoint
app.get('/api/search', (req,res) => {
  const q = req.query.q || '';
  const hits = searchTables(q);
  res.json({ hits });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
```

---

## Frontend — `frontend/package.json`

```json
{
  "name": "smart-campus-frontend",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "fuse.js": "^6.6.2"
  },
  "scripts": {
    "start": "vite"
  }
}
```

> Use Vite or Create React App. Below code assumes Vite + React.

---

## Frontend — `frontend/src/index.jsx`

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')).render(<App />)
```

---

## Frontend — `frontend/src/App.jsx`

```jsx
import React, { useState } from 'react'
import Chat from './components/Chat'

export default function App(){
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto bg-white shadow-lg rounded-2xl p-6">
        <h1 className="text-2xl font-bold mb-4">Smart Campus Assistant</h1>
        <p className="text-sm text-gray-600 mb-4">Ask about schedules, facilities, dining, library or admin procedures.</p>
        <Chat />
      </div>
    </div>
  )
}
```

---

## Frontend — `frontend/src/components/Chat.jsx`

```jsx
import React, { useState } from 'react'

export default function Chat(){
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I can help with schedules, facilities, dining, library, and admin. What would you like to know?' }
  ]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [useLLM, setUseLLM] = useState(false);

  async function send() {
    if (!text.trim()) return;
    const userMsg = { role: 'user', text };
    setMessages(m => [...m, userMsg]);
    setText('');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:4000/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, useLLM })
      });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data.reply || 'Sorry, no response' }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: 'Error contacting server' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="space-y-3 mb-4">
        {messages.map((m,i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block p-3 rounded-lg ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input className="flex-1 p-2 border rounded" value={text} onChange={e => setText(e.target.value)} placeholder="Ask about library hours, where is the gym, etc." />
        <button onClick={send} className="py-2 px-4 bg-green-600 text-white rounded">Send</button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={useLLM} onChange={e=>setUseLLM(e.target.checked)} /> Use LLM (if backend configured)</label>
        {loading && <span>Thinking...</span>}
      </div>
    </div>
  )
}
```

---

## Frontend — `frontend/src/styles.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Add any custom style here */
```

---

## Setup & Run (local)

1. Create project folders `backend` and `frontend` and paste the corresponding files.
2. In `backend` run:

```bash
npm install
# optionally set OPENAI_API_KEY in your env if you want LLM replies
node server.js
```

3. In `frontend` run:

```bash
npm install
npm run start
```

4. Visit the frontend (Vite default http://localhost:5173) and make sure backend runs on port 4000.

---

## Notes & Extensions

- **Authentication & Roles:** Add JWT auth for admin endpoints before exposing add/update/delete.
- **Better search:** Add SQLite FTS5, or embed vector search (Milvus/Pinecone) for semantic retrieval.
- **Deployment:** Deploy backend on Heroku/Render, frontend on Vercel/Netlify. Use environment variables for sensitive keys.
- **Data ingestion:** Add CSV importer for bulk seed; provide admin UI to edit records.
- **Accessibility & Internationalization:** Add i18n and ARIA attributes for wider usage.

---

If you'd like, I can:
- produce the exact files in a downloadable zip,
- convert the frontend to Next.js,
- or implement vector search + example OpenAI calls wired end-to-end.

Tell me which of those you'd like and I'll add it straight into the project files.
