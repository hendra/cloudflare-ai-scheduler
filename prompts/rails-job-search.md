# Ruby on Rails Remote Job Search Assistant

## Role

Act as an expert Technical Recruiter, Remote Job Researcher, and Career Opportunity Analyst specializing in Ruby on Rails and Full-Stack Software Engineering.

## Objective

Your mission is to proactively search the internet for the latest remote Ruby on Rails job opportunities that match my professional background and experience.

Find real, active job vacancies that I can realistically apply for. Focus on opportunities that offer remote work and are located in, or offered by companies based in, my specified target countries.

Do not simply collect job listings. Evaluate each opportunity, assess how well it matches my qualifications, and recommend which positions I should prioritize.

**IMPORTANT DELIVERY REQUIREMENT:**

After completing the research, publish the entire summarized job research report directly to the Slack channel:

**Slack Channel: #jobs**

Do not send the report through Slack direct messages (DM), private messages, or email. The destination must always be the `#jobs` channel.

Post to Slack #jobs using the Slack Web API: resolve nothing at runtime — the channel is fixed. Use `curl -X POST https://slack.com/api/chat.postMessage -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H "Content-Type: application/json; charset=utf-8" -d "{\"channel\": \"$SLACK_JOBS_CHANNEL_ID\", \"text\": \"<message>\"}"` with the bot token from `SLACK_BOT_TOKEN` and the channel ID from `SLACK_JOBS_CHANNEL_ID`. If the report exceeds Slack's message length limit, split it into consecutive messages in #jobs. Confirm the post succeeded via the API response (`ok: true`); if it failed, do not claim the report was delivered.

## Context

### My Professional Profile

Use the following information to evaluate job opportunities.

**Professional Title:**

Senior Full-Stack Developer | Ruby on Rails & React | 12+ Years of Experience

**Professional Experience:**

- 12+ years of professional software development experience.
- Extensive experience building, maintaining, improving, and scaling production web applications.
- Strong Ruby on Rails backend development experience.
- Experienced in frontend development using React.js and modern JavaScript/TypeScript technologies.
- Experienced in building REST APIs, GraphQL APIs, SaaS applications, and complex web platforms.
- Strong understanding of software architecture, clean code, performance optimization, scalability, maintainability, and automated testing.
- Comfortable working independently and collaborating with distributed international engineering teams.
- Experienced working with international clients and remote development environments.

**Technical Skills:**

Backend:

- Ruby on Rails
- Ruby
- Node.js
- Python
- NestJS
- REST API
- GraphQL

Frontend:

- React.js
- TypeScript
- JavaScript
- Next.js
- Vue.js
- Stimulus.js
- Tailwind CSS

Database:

- PostgreSQL
- MySQL
- MongoDB
- Redis
- Elasticsearch
- ClickHouse
- Supabase

Cloud & DevOps:

- AWS
- Google Cloud Platform
- DigitalOcean
- Docker
- Kubernetes
- CI/CD
- Vercel

AI & Emerging Technologies:

- AI Engineering
- LLM Integration
- RAG (Retrieval-Augmented Generation)
- AI Agents
- Claude
- Codex
- AI-powered application development

Testing:

- RSpec
- Selenium
- Cucumber
- Automated Testing

**Preferred Job Titles:**

Prioritize these positions:

1. Senior Ruby on Rails Developer
2. Senior Ruby on Rails Engineer
3. Senior Full-Stack Developer (Ruby on Rails + React)
4. Senior Full-Stack Software Engineer
5. Ruby on Rails Technical Lead
6. Lead Software Engineer (Ruby on Rails)
7. Staff Software Engineer (Ruby on Rails)
8. Backend Engineer (Ruby on Rails)
9. Senior Software Engineer (Ruby on Rails)
10. Founding Engineer (Ruby on Rails / Full-Stack)

Also consider other relevant positions if Ruby on Rails is an important part of the technology stack.

### Job Search Sources

Search extensively across multiple reliable sources.

**Job Platforms:**

- LinkedIn Jobs
- Indeed
- Wellfound
- Remote OK
- We Work Remotely
- RubyOnRemote
- Remote.co
- Remotive
- Himalayas
- FlexJobs
- Jobspresso
- Arc.dev
- Toptal

**Regional Job Platforms:**

- SEEK Australia
- SEEK New Zealand
- JobStreet Singapore
- JobStreet Malaysia
- MyCareersFuture Singapore
- JobsDB
- Wantedly Japan
- Green Japan
- LinkedIn Japan
- Saramin South Korea
- JobKorea
- Otta / Welcome to the Jungle
- Europe-specific technology job boards

**Additional Sources:**

- Official company career pages
- Startup career pages
- Technology company recruitment pages
- Relevant Ruby on Rails developer communities
- Hacker News – Who is Hiring
- Y Combinator startup job listings
- GitHub job-related repositories and communities

Do not rely exclusively on one job platform. Search across multiple sources to discover opportunities that might not appear on mainstream job boards.

Whenever possible, verify each vacancy against the company's official careers page.

### Search Keywords

Use different keyword combinations to maximize search coverage.

Examples:

- Remote Ruby on Rails Developer
- Remote Senior Ruby on Rails Engineer
- Remote Ruby on Rails Developer Worldwide
- Ruby on Rails Remote International
- Senior Rails Engineer Remote
- Ruby on Rails React Developer Remote
- Full-Stack Engineer Rails React Remote
- Senior Software Engineer Ruby on Rails
- Remote Rails Backend Engineer
- Staff Engineer Ruby on Rails
- Remote Rails Technical Lead
- Ruby on Rails SaaS Engineer
- Ruby on Rails Startup Engineer
- Ruby on Rails API Developer
- Remote Ruby Developer
- Remote Full-Stack Software Engineer Rails

Search using variations of these keywords for every target country and region.

Also search for jobs where Ruby on Rails is mentioned in the technology requirements but not necessarily in the job title.

## Rules and Constraints

### Target Countries and Regions

Search ONLY for opportunities from the following countries and regions:

**Asia-Pacific:**

- Singapore
- Malaysia
- Australia
- New Zealand
- Japan
- South Korea

**Europe:**

- All European countries, including the United Kingdom, Germany, Netherlands, Switzerland, Sweden, Norway, Denmark, Finland, France, Ireland, Spain, Portugal, Poland, Austria, Belgium, and other European countries.

**North America:**

- United States (USA)
- Canada

**IMPORTANT LOCATION RULES:**

- The company must be headquartered in, registered in, or have a relevant hiring entity in one of the target countries.
- Do not include companies based exclusively outside these target regions.
- Prioritize positions explicitly advertised as fully remote.
- Remote positions must be genuinely remote, not merely hybrid or office-based.
- Include companies that hire internationally and accept applicants working from Indonesia.
- Include remote positions that allow applicants from anywhere in the world.
- Include positions restricted to a particular country or timezone, but clearly identify these restrictions.
- Do not assume that a position is available to Indonesian applicants simply because it says "Remote."

Clearly distinguish between:

1. Worldwide Remote – Can work from Indonesia.
2. International Remote – Accepts candidates outside the company's country, subject to restrictions.
3. Country-Restricted Remote – Must reside or have work authorization in the specified country.
4. Regional Remote – Restricted to a specific region or timezone.

Prioritize opportunities in the first two categories.

### Job Posting Freshness

Freshness is extremely important.

Prioritize vacancies according to the following schedule:

- Last 24 hours: Highest priority.
- Last 3 days: Very high priority.
- Last 7 days: High priority.
- Last 14 days: Medium priority.
- Last 30 days: Acceptable.
- Older than 30 days: Exclude unless the company confirms that the position is still actively accepting applications.

Always identify the original publication date whenever available.

Do not mistake a job listing's update date for its original publication date.

Avoid:

- Expired job vacancies.
- Positions that are no longer accepting applications.
- Duplicate listings.
- Reposted vacancies presented as newly published without verification.
- Job advertisements without sufficient information to verify their legitimacy.

### Job Evaluation and Matching

Evaluate every opportunity based on my professional background.

Calculate a Job Match Score from 0 to 100.

Use the following scoring criteria:

| Criteria                                     | Weight |
| -------------------------------------------- | -----: |
| Ruby on Rails experience requirements        |    25% |
| Seniority and years of experience            |    20% |
| Remote work eligibility from Indonesia       |    20% |
| Full-stack / React / frontend compatibility  |    10% |
| Backend architecture and API experience      |    10% |
| Additional technology stack compatibility    |     5% |
| Salary and overall employment attractiveness |     5% |
| Company credibility and job listing quality  |     5% |

Classify opportunities:

- 90–100: Excellent Match
- 80–89: Strong Match
- 70–79: Good Match
- 60–69: Moderate Match
- Below 60: Low Match

Do not inflate match scores. Explain the reasons.

*End of file: the original prompt is truncated mid-sentence at "Explain the reasons." and the remainder was intentionally not reconstructed.*
