# EduPredict

Student performance prediction and academic analytics for educators.

**The problem:** a teacher with 150 students can't watch all of them. Students slip quietly, nobody notices in time, and when someone does, the follow-up gets forgotten.

**What EduPredict does:** it makes sure no struggling student is missed or forgotten. Each week, teachers open a short list of who needs attention, why, and what has changed. They record who will do what by when, overdue follow-ups rise to the top, and the school can see how flagged courses ended.

Behind the list, machine learning estimates the chance that a final course grade will fall below the pass mark, and predicts the grade itself. Educators, administrators and students each get their own role-restricted view.

Predictions are decision support, not judgments about students. **The model does not predict dropout**: the dataset has no dropout label.

![The weekly support list](docs/screenshots/this-week.png)

## Contents

- [Screenshots](#screenshots)
- [The weekly workflow](#the-weekly-workflow)
- [Quick start with Docker](#quick-start-with-docker)
- [Local development](#local-development)
- [Roles](#roles)
- [The machine learning pipeline](#the-machine-learning-pipeline)
- [Model results](#model-results)
- [Responsible use](#responsible-use)
- [Project layout](#project-layout)
- [API](#api)
- [Database](#database)
- [Testing](#testing)
- [Deployment](#deployment)

## Screenshots

All students shown are pseudonymous demonstration records from the public UCI dataset.

| Dashboard | Student profile |
| --- | --- |
| ![Dashboard with pass rate, concern levels and grade distribution](docs/screenshots/dashboard.png) | ![Student profile with grade progress and latest predictions](docs/screenshots/student-profile.png) |
| **Results** | **Student portal** |
| ![Results page showing how flagged courses ended](docs/screenshots/results.png) | ![Student view of grades and shared recommendations](docs/screenshots/student-portal.png) |

![Landing page](docs/screenshots/landing.png)

## The weekly workflow

| Step | Where | What happens |
| --- | --- | --- |
| 1. Keep records current | Students, Datasets | Grades and absences are entered by hand or imported from a CSV |
| 2. Update the list | This week, **Update from records** | Only courses whose records changed are re-scored |
| 3. See who needs attention | This week | Sorted by urgency: overdue first, then students who just got worse |
| 4. See what changed | This week | Plain statements, such as "Absences up from 4 to 25" |
| 5. Plan support | This week, student profile | A step, a person responsible and a follow-up date |
| 6. Follow through | This week, student profile | Mark done with what happened, reschedule or cancel |
| 7. See how it went | Results | What was flagged, what was done, and how those courses ended |

A course leaves the list when its final grade is recorded. After a step is completed, the course waits for new results, and comes back if a new prediction still flags it.

**What Results can't tell you:** it counts what happened, but doesn't prove that support caused a result, because teachers may choose to help some students over others. Showing that the system helps would need a proper evaluation at a real school.

**Current limits:**

- Every educator sees every student, because classes aren't assigned to teachers yet.
- Reminders appear in the app only. There are no emails or notifications.
- Records are updated by hand or CSV. There's no connection to a school information system.
- Demo students stay on the list even though their final grades are known, so the workflow can be tried. The list says so.

## Quick start with Docker

You need Docker with Compose.

```bash
cp .env.example .env
```

Edit `.env` and replace every `CHANGE_ME` value. To generate `SECRET_KEY`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Then start everything:

```bash
docker compose up -d --build
```

The first build trains the models from the bundled data, so it takes a few minutes.

| What | Where |
| --- | --- |
| Web app | http://localhost:8088 |
| API documentation (Swagger) | http://localhost:8000/api/docs |
| API documentation (ReDoc) | http://localhost:8000/api/redoc |
| Health check | http://localhost:8000/api/health |

On start, the backend applies database migrations and creates the first admin from `FIRST_ADMIN_EMAIL` and `FIRST_ADMIN_PASSWORD`.

Those two values only apply when no account with that email exists. Changing the password later has no effect, and changing the email creates a second admin on the next start rather than renaming the first. To change an existing admin's details, use the Settings page.

### Demonstration data

With `SEED_DEMO_DATA=true`, the first start also creates:

- Pseudonymous students ("Demo Student 0001") from the held-out UCI test split, which the models never trained on.
- Real model predictions for those students, at the "after first period" stage.
- Two logins, `educator@edupredict.demo` and `student@edupredict.demo`, both using `DEMO_PASSWORD`.

All of it is flagged `is_demo` and labelled in the interface and in reports. Set `SEED_DEMO_DATA=false` in production.

## Local development

You need Python 3.14 and Node 24. Docker is the easiest way to run PostgreSQL.

```bash
# Database only
docker compose up -d db

# Backend, from backend/
python -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python -m ml.train                # creates the model artifacts
alembic upgrade head
python -m scripts.bootstrap
uvicorn app.main:app --reload

# Frontend, from frontend/
npm ci
npm run dev                       # http://localhost:5173, proxies /api to port 8000
```

## Roles

| Capability | Admin | Educator | Student |
| --- | --- | --- | --- |
| Manage users and platform settings | Yes | | |
| View platform activity and audit trail | Yes | | |
| Upload and import datasets | Yes | If an admin allows it | |
| Weekly list, support plans and results | Yes | Yes | |
| Manage students and academic records | Yes | Yes | |
| Run and review predictions, view history | Yes | Yes | |
| Analytics, model information, reports and exports | Yes | Yes | |
| View own grades and progress | | | Yes |
| View recommendations an educator has shared | | | Yes |

Students never see risk scores. New registrations are always student accounts with no linked record: because email ownership isn't verified, staff link an account to a record explicitly. Educator and admin accounts are created by an admin.

Every permission is enforced by the API. The route guards in the frontend only control navigation.

## The machine learning pipeline

### Dataset

[Student Performance](https://archive.ics.uci.edu/dataset/320/student+performance), UCI Machine Learning Repository, dataset 320. Licence: CC BY 4.0. DOI: [10.24432/C5TG7T](https://doi.org/10.24432/C5TG7T).

> Cortez, P. & Silva, A. M. G. (2008). Using data mining to predict secondary school student performance. *Proceedings of the 5th Future Business Technology Conference*, 5-12.

It holds 1,044 course rows (649 Portuguese, 395 Mathematics) from two Portuguese secondary schools, collected in 2005-2006. There are no missing values or exact duplicates.

### What is predicted

- **Classifier:** the probability that the final grade (G3) is below 10 out of 20.
- **Regressor:** the final grade itself, with a range around it.

### Preventing data leakage

- **Three stages.** Each stage has its own models, and uses only what exists at that point: start of course (no grades), after first period (adds G1), and after second period (adds G1 and G2).
- **Group-aware split.** About 60/20/20, stratified, and grouped by the dataset authors' student identity key. A student taking both subjects can't appear on both sides of a split.
- **Test data is held back.** Models and risk bands are chosen on training and validation data only.
- **Preprocessing is inside the saved pipeline.** Encoding is fitted during training and applied automatically at prediction time, so there's no second copy to drift.

### Reproducing it

From `backend/`:

```bash
python -m ml.eda     # data checks and figures: ml/reports/eda_summary.json, ml/reports/figures/
python -m ml.train   # trains and saves models to ml/artifacts/, writes ml/reports/model_report.md
```

Logistic Regression, Decision Tree, Random Forest and Gradient Boosting are compared for classification, with Ridge and tree-based models for regression, using cross-validation. The winner is chosen on the validation split and saved with Joblib. The full comparison is in [model_report.md](backend/ml/reports/model_report.md) and on the Model Information page.

## Model results

Measured on the held-out test split (209 course rows, 22% below the pass mark). Values come from [model_report.md](backend/ml/reports/model_report.md). The app reads its figures from the saved training metadata.

**Below-pass classifier**

| Stage | Algorithm | Accuracy | Precision | Recall | F1 | ROC-AUC |
| --- | --- | --- | --- | --- | --- | --- |
| Start of course | Logistic Regression | 0.780 | 0.500 | 0.500 | 0.500 | 0.775 |
| After first period | Random Forest | 0.876 | 0.685 | 0.804 | 0.740 | 0.940 |
| After second period | Logistic Regression | 0.909 | 0.800 | 0.783 | 0.791 | 0.970 |

Always predicting "pass" would score an accuracy of 0.780 and find no one, so accuracy alone says little here. The start-of-course model only matches that accuracy. Its value is in ranking students, and its flags are right about half the time, so treat it as a weak signal.

**Final grade regressor** (0-20 scale; predicting the average gives an RMSE of 3.99)

| Stage | Algorithm | MAE | MSE | RMSE | R² |
| --- | --- | --- | --- | --- | --- |
| Start of course | Gradient Boosting | 2.438 | 10.747 | 3.278 | 0.323 |
| After first period | Random Forest | 1.360 | 4.400 | 2.098 | 0.723 |
| After second period | Random Forest | 0.793 | 1.738 | 1.318 | 0.891 |

The grade range aims to cover 80% of outcomes. On the test split it covered 78.0%, 75.6% and 81.3% across the three stages.

Retraining in Docker can change these figures slightly if library builds differ. Check the Model Information page for the deployed version.

## Responsible use

- **Excluded features.** Sex, age, family background, parental education and jobs, home address, health, alcohol use and other sensitive or proxy columns are never model inputs. Each exclusion and its reason is listed in [config.py](backend/ml/config.py) and on the Model Information page.
- **Fairness audit.** Error rates by sex, address, parental education and school are measured on the test split and published in the app. These columns are used only for the audit. Groups are small, so differences are uncertain.
- **Bias.** Historical data can encode bias, and removing protected attributes doesn't remove it, because other inputs can act as proxies.
- **Limited scope.** Results come from two Portuguese schools in 2005-2006. Validate locally before relying on them anywhere else.
- **Human review.** Educators can record their own judgment next to any prediction, and rule-based suggestions stay private to staff until someone shares them. These suggestions are rules of thumb, not validated interventions.

## Project layout

```text
backend/
  app/            FastAPI application: routes, services, models, schemas
  alembic/        Database migrations
  ml/             Dataset, training, evaluation, inference and reports
  scripts/        First-admin and demonstration data bootstrap
  tests/          Pytest suite
frontend/
  src/api/        HTTP client, types, data-fetching hook
  src/components/ Layout, UI kit, charts, forms
  src/context/    Authentication and toast state
  src/pages/      One file per screen
  src/test/       Vitest and React Testing Library suite
docker-compose.yml
.env.example
```

## API

Interactive documentation is generated from the code at `/api/docs`. The main groups are:

| Group | Endpoints |
| --- | --- |
| Authentication | `POST /api/auth/register`, `login`, `logout`, `change-password`; `GET` and `PUT /api/auth/me` |
| Users (admin) | `GET`, `POST /api/users`; `PUT`, `DELETE /api/users/{id}` |
| Students | `GET`, `POST /api/students`; `GET`, `PUT`, `DELETE /api/students/{id}`; `GET /api/students/me` |
| Records and advice | `POST`, `PUT`, `DELETE` under `/api/students/{id}/records`; `POST`, `PATCH`, `DELETE` under `/api/students/{id}/recommendations` |
| Support workflow | `GET /api/support/watchlist`, `results`, `staff`; `POST /api/support/refresh`; `GET`, `POST /api/support/actions`; `PATCH`, `DELETE /api/support/actions/{id}` |
| Predictions | `POST`, `GET /api/predictions`; `GET /api/predictions/{id}`; `POST /api/predictions/{id}/review`; `GET /api/predictions/options` |
| Analytics | `GET /api/analytics/overview`, `performance`, `distribution`, `trends`, `attention`, `system` |
| Model | `GET /api/model/info`, `metrics`, `versions` |
| Reports | `GET /api/reports/performance`, `risk` (`?format=json` or `csv`) |
| Datasets | `POST /api/datasets/upload`; `GET /api/datasets`; `GET`, `DELETE /api/datasets/{id}`; `POST /api/datasets/{id}/process`; `GET /api/datasets/template` |
| Settings (admin) | `GET`, `PUT /api/settings` |

## Database

PostgreSQL 16, with migrations managed by Alembic. The tables are `users`, `students`, `academic_records`, `predictions`, `prediction_history`, `model_versions`, `academic_recommendations`, `support_actions`, `datasets`, `system_settings` and `audit_logs`. Student identity is stored once in `students`, and everything else references it.

```bash
alembic upgrade head                         # apply migrations
alembic revision --autogenerate -m "change"  # create a new one
```

## Testing

```bash
# Backend, from backend/. Uses a temporary SQLite database by default.
python -m pytest
python -m ruff check .

# Against PostgreSQL. Use a throwaway database, because tables are dropped between tests.
TEST_DATABASE_URL=postgresql+psycopg://user:password@host/test_db python -m pytest

# Frontend, from frontend/
npm test
npm run typecheck
```

## Image credits

The photos in `frontend/public/images/` come from [Unsplash](https://unsplash.com/license) and are decorative. They don't show a real school or real users of this software.

| File | Source |
| --- | --- |
| `library.webp` | `images.unsplash.com/photo-1427504494785-3a9ca7044f45` |
| `books.webp` | `images.unsplash.com/photo-1497633762265-9d179a990aa6` |
| `desk.webp` | `images.unsplash.com/photo-1503676260728-1c00da094a0b` |
| `teachers.webp` | `images.unsplash.com/photo-1522202176988-66273c2fd55f` |

The book illustration on empty pages was drawn for this project.

## Deployment

The Compose file is a sound base, but a public deployment needs more:

1. **Secrets.** Generate a new `SECRET_KEY` and strong passwords, and supply them through your platform's secret store. Never commit `.env`.
2. **HTTPS.** The Compose file publishes ports on `127.0.0.1` only. Put a TLS-terminating reverse proxy (Caddy, nginx or a cloud load balancer) in front of the frontend container. Logins and student data must not travel over plain HTTP.
3. **Environment.** Set `SEED_DEMO_DATA=false`, and `CORS_ORIGINS` to your real origin.
4. **Registration.** Decide whether to turn off public registration in Settings.
5. **Backups.** Back up the `pgdata` and `uploads` volumes, and test restoring them. Student data is personal data, so check your obligations under the laws that apply to you, such as GDPR or FERPA.
6. **Local validation.** Evaluate the model on your own students' outcomes before relying on it. It was trained on a small, old dataset from another context.
