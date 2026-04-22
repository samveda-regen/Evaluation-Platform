# Online Examination Platform

A comprehensive web-based testing platform with Admin and Candidate modules, supporting MCQ and coding-based tests with anti-cheating mechanisms.

## Features

### Admin Module
- **Authentication**: Secure admin login with hashed passwords and JWT tokens
- **Test Management**: Create, edit, delete tests with configurable settings
  - Duration, start/end times
  - Total marks, passing criteria, negative marking
  - Shuffle questions and options
  - Max violations before auto-submit
- **Question Management**:
  - MCQ questions (single/multiple choice)
  - Coding questions with test cases
  - Support for multiple programming languages
- **Results & Analytics**:
  - View all candidate submissions
  - Detailed attempt analysis
  - Activity logs and violation tracking
  - Export results to CSV/JSON
  - Re-evaluation support

### Candidate Module
- **Secure Login**: Email + Test Code authentication
- **Test Interface**:
  - Instructions page with rules
  - Full-screen mandatory mode
  - Timer with auto-submit
  - Question navigation panel
  - Auto-save answers
- **Code Editor**: Monaco editor with syntax highlighting

### Anti-Cheating Mechanisms
- Full-screen enforcement
- Tab switch detection
- Window focus monitoring
- Copy/paste prevention
- Right-click disabled
- Keyboard shortcuts blocked (Ctrl+C, Ctrl+V, F12)
- Activity logging
- Violation counting with auto-submit

## Tech Stack

### Backend
- Node.js + Express.js
- TypeScript
- Prisma ORM with PostgreSQL
- JWT Authentication
- Socket.io for real-time features
- Helmet + CORS for security
- Rate limiting

### Frontend
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Monaco Editor
- Zustand (state management)
- React Router
- React Hot Toast

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Python 3.9+

> **Windows / PowerShell users:** PowerShell does not support `&&` as a command separator.
> Run commands on separate lines, or use `;` to chain them (note: `;` runs both even if the first fails).
> ```powershell
> # Instead of:  npm run build && npm start
> npm run build
> npm start
> # or
> npm run build; if ($?) { npm start }
> ```

### Installation

1. **Clone and install dependencies**

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

2. **Set up the database**

```bash
cd backend

# Ensure PostgreSQL is running locally on port 5432
# and backend/.env has:
# DATABASE_URL="postgresql://<user>:<password>@localhost:5432/test_platform"
# FRONTEND_URL="http://localhost:5173"
# NODE_ENV=development

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Seed initial data (optional)
npm run db:seed

# Seed Library (adds 10 MCQ + 10 Coding + 10 Behavioral QUESTION_BANK entries)
npm run db:seed:question-bank
```
3. **Start the development servers**

Open a separate terminal for each service:

```bash
# Terminal 1 - Backend (runs on port 3000)
cd backend
npm run dev

# Terminal 2 - Frontend (runs on port 5173)
cd frontend
npm run dev

# Terminal 3 - Python CV Service (runs on port 8010)
cd python_cv_service
python -m venv .venv

# Activate venv:
#   Windows (PowerShell): .venv\Scripts\Activate.ps1
#   Windows (CMD):        .venv\Scripts\activate.bat
#   Linux/Mac:            source .venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8010 --reload
```

4. **Access the application**
- Admin Portal: http://localhost:5173/admin/login
- Candidate Portal: http://localhost:5173/test/login

### Default Credentials (after seeding)
- **Admin**: admin@example.com / admin123
- **Demo Test Code**: DEMO2024

## Troubleshooting Login

If login fails, verify backend and DB first:

```bash
# 1) Check backend health
curl http://localhost:3000/api/health

# Expected success payload:
# {"status":"ok","database":"connected",...}
```

- If health returns `database: "disconnected"` or backend exits on startup:
  - Start PostgreSQL.
  - Recheck `backend/.env` `DATABASE_URL`.
  - Run `cd backend && npm run db:generate && npm run db:push`.
- If admin login says invalid credentials:
  - Run `cd backend && npm run db:seed` and login with `admin@example.com / admin123`.

## Project Structure

```
EvaluationPlatform/
├── backend/
│   ├── src/
│   │   ├── controllers/      # Route handlers
│   │   ├── middleware/       # Auth, validation
│   │   ├── routes/           # API routes
│   │   ├── services/         # Business logic
│   │   ├── types/            # TypeScript types
│   │   ├── utils/            # Helpers (JWT, sanitize, code executor)
│   │   └── index.ts          # Entry point
│   ├── prisma/
│   │   └── schema.prisma     # Database schema
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/       # Reusable components
│   │   ├── context/          # Zustand stores
│   │   ├── pages/
│   │   │   ├── admin/        # Admin pages
│   │   │   └── candidate/    # Candidate pages
│   │   ├── services/         # API client
│   │   ├── types/            # TypeScript types
│   │   ├── App.tsx           # Main app with routing
│   │   └── main.tsx          # Entry point
│   └── package.json
│
└── README.md
```

## API Endpoints

### Admin Routes (`/api/admin`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /register | Register new admin |
| POST | /login | Admin login |
| GET | /profile | Get admin profile |
| GET | /dashboard | Dashboard stats |
| GET | /tests | List tests |
| POST | /tests | Create test |
| GET | /tests/:id | Get test details |
| PUT | /tests/:id | Update test |
| DELETE | /tests/:id | Delete test |
| POST | /tests/:id/questions | Add question to test |
| GET | /mcq | List MCQ questions |
| POST | /mcq | Create MCQ |
| GET | /coding | List coding questions |
| POST | /coding | Create coding question |
| GET | /tests/:id/results | Get test results |
| GET | /tests/:id/export | Export results |

### Candidate Routes (`/api/candidate`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /login | Candidate login |
| GET | /test | Get test details |
| POST | /test/start | Start test |
| POST | /answer/mcq | Save MCQ answer |
| POST | /answer/coding | Save coding answer |
| POST | /code/run | Run code |
| POST | /activity | Log activity |
| POST | /test/submit | Submit test |

## Configuration

### Environment Variables

Create `.env` files in backend folder:

```env
# Backend .env
PORT=3000
JWT_SECRET=your-secure-jwt-secret
FRONTEND_URL=http://localhost:5173
# Optional: candidate-facing URL for invitation emails
# CANDIDATE_FRONTEND_URL=https://your-domain.com
MAIL_PROVIDER=smtp
# SMTP configuration for invitation emails
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM="Test Platform <no-reply@your-domain.com>"

# Zoho example (organization/custom domain mailbox)
SMTP_PROVIDER=zoho
ZOHO_ACCOUNT_TYPE=organization
ZOHO_DATA_CENTER=au
SMTP_HOST=smtppro.zoho.com.au
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=false
# SMTP_USER must be full mailbox address
# SMTP_PASS should be Zoho app password if 2FA is enabled
```

## Security Features

- Password hashing with bcrypt (12 rounds)
- JWT token authentication
- Rate limiting on auth endpoints
- Input sanitization (XSS prevention)
- Helmet security headers
- CORS configuration
- Sandboxed code execution

## Building for Production

```bash
# Backend
cd backend
npm run build
node dist/index.js

# Frontend
cd frontend
npm run build
npm run preview

# Python CV Service (multi-worker, Linux/Mac)
cd python_cv_service
bash start.sh
# or manually (all platforms):
uvicorn app:app --host 0.0.0.0 --port 8010 --workers 4
```

| Service | Port | Dev Command | Prod Command |
|---|---|---|---|
| Backend | 3000 | `npm run dev` | `npm run build` then `node dist/index.js` |
| Frontend | 5173 | `npm run dev` | `npm run build` then `npm run preview` |
| Python CV | 8010 | `uvicorn app:app --port 8010 --reload` | `uvicorn app:app --port 8010 --workers 4` |

## Production Deployment (Local SQL + Services)

Use direct services (no Docker):

- PostgreSQL database
- Backend API (`backend`)
- Frontend app (`frontend`)
- Python CV proctoring service (`python_cv_service`)

### 1) Start PostgreSQL

Create database:

```sql
CREATE DATABASE test_platform;
```

### 2) Configure backend env

Set in `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/test_platform
PORT=3000
FRONTEND_URL=http://localhost:5173
PYTHON_CV_SERVICE_URL=http://localhost:8010
```

### 3) Start backend

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run build
node dist/index.js
```

### 4) Start Python CV service

```bash
cd python_cv_service
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8010
```

### 5) Start frontend

```bash
cd frontend
npm install
npm run dev
```

### 6) Verify health

- Backend: `http://localhost:3000/api/health`
- CV service: `http://localhost:8010/health`

## License

MIT
