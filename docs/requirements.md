# Nabda (نبضة) - Requirements Baseline

Status: BASELINE of the system as built (no new client request). Reverse-engineered from the code on 2026-10-10. Where older docs (README, PLAN, briefs) disagree with the code, the code wins and the disagreement is listed in Open questions.

Sources: `CLAUDE.md`, `README.md`, `PLAN.md`, `DEPLOY-TASKS.md`, `server/game.js`, `server/index.js`, `server/banks.js`, `server/intake.js`, `server/audit.js`, `server/store.js`, `client/src/pages/*`, `client/*.mjs` tests.

## 1. Summary

Nabda is a live team quiz game played in a hall. An organiser creates a room; teams join from their phones (one device per team); a projector shows the room. All teams play the same round at the same time, each against its own countdown ("pulse"). A correct answer adds time, a wrong one subtracts time. The first clock to reach zero ends the round for everyone. Points are awarded per round (correct answers plus a rank bonus). Between rounds teams spend points on cards (extra time, freeze, steal, shield and others) that take effect in the next round. A separate owner console manages question banks, pending questions, rooms history, reports and feedback. The UI is Arabic only, RTL.

## 2. Scope

### In scope (as built)
1. Room creation by an organiser at `/admin` (name, question banks, school stage).
2. Team join/rejoin at `/play` with a room code, including same-device resume and late joining.
3. Projector display at `/display` (lobby with QR, live board, card events, final standings, blur toggle).
4. Round engine: 3 s countdown, server-authoritative clocks, correct/wrong time effects, flatline grace, offline-drop rule, pause, resume, restart round, late-answer window.
5. Scoring: per-round points, rank ladder, double multiplier, cumulative score, final standings.
6. Card shop between rounds: 10 card types with price and per-game limit, purchase, refund, attack/defence resolution.
7. Organiser tools: manual time/score adjustment, remove team, reopen cards, finish game, restart game, question feed with reporting, round history, link copying, keyboard shortcuts.
8. Player reports on questions, rating and comment for organisers and players.
9. Owner console at `/console` guarded by `NABDA_OWNER_KEY`: dashboard, banks (questions, pending intake, reports, edits history, bank shelf), rooms, comments.
10. Bank management: create, activate/deactivate, delete to trash (30 days), restore; question edit/delete with archive; pending intake (manual, paste, CSV), approval, duplicate and quality audit.
11. Persistence in PostgreSQL (rooms history, live snapshots, stats, feedback, banks, edits, trash, pending); crash recovery restoring rooms paused.
12. Operations: `/api/health`, `/api/live`, `npm run live`, pre-push hook, `pull-banks`, auto-deploy on push to `main`.

### Out of scope (a client might assume these are included, they are NOT)
1. Any language other than Arabic; any LTR layout.
2. User accounts, passwords, player profiles, login for organisers (an organiser is whoever holds the room admin key).
3. Payments, SMS, email, push notifications, social login.
4. Multiple server instances, autoscaling, serverless hosting.
5. A UI for changing round parameters (start seconds, bonus, penalty, max seconds): the server accepts them but no screen exposes them.
6. Teams with several devices, or several players answering separately inside one team (one device is one team).
7. Spectator chat, team chat, leaderboards across rooms or across games, global player rankings.
8. Automatic resume of a round after a server restart (always restored paused).
9. Question images other than the optional country flag (`flag`) on a question.
10. Self-service for clients to run their own owner console (single owner key).
11. Native mobile apps.
12. Importing banks from the JSON files into the database after first seed (removed on purpose; see README).
13. Role-based permissions in the console (one owner key, full access).

## 3. Users and roles

| Role | Surface | Can do |
|---|---|---|
| Visitor | `/` | Read the four rules, enter a room code, navigate to join/display/create. |
| Team (player) | `/play` (one device per team) | Join with a team name, answer questions, buy/refund cards between rounds, review answers after a round, report a question after a round, leave a rating/comment. |
| Projector display | `/display?code=` | Read-only view of a room: lobby QR and teams, live lanes, card events, standings. No authentication beyond knowing the room code. |
| Organiser (admin) | `/admin` | Create a room, choose banks and stage, start/pause/resume/restart rounds, adjust time and score, remove teams, reopen cards, blur the display, finish or restart the game, report questions, comment. Authenticated per room by `adminKey`. |
| Owner | `/console` | Everything about banks, pending questions, rooms history, reports and comments. Authenticated by `NABDA_OWNER_KEY` sent in `x-nabda-key`. |

Main flows:
- Organiser creates room -> shares play link/QR -> teams join -> organiser presses start -> 3 s countdown -> round runs until the first flatline -> results and shop -> next round ... -> organiser finishes game -> standings -> optional feedback.
- Owner reviews dashboard/reports -> edits or approves questions -> bank content changes for future rooms.

## 4. Functional requirements

Priority tags are MoSCoW (section 10). Constants are quoted from the code.

### 4.1 Room creation and settings

**FR-01 (Must): As an organiser, I want to create a named room so that teams can join it.**
- Given I am on `/admin` with no room, When the room name is empty or whitespace, Then the create button is disabled and the server answers "اكتب اسم الغرفة" to a direct request.
- Given a non-empty name, at least one bank and a stage, When I create the room, Then the server returns a 4-character room code (alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, no look-alike characters), an `adminKey`, and the room starts in status `lobby` at round 1.
- Given a name longer than 40 characters, When it is submitted, Then it is truncated to 40 characters.
- Given unknown bank ids, When the room is created, Then invalid ids are dropped and if none remain the first bank is used.

**FR-02 (Must): As an organiser, I want sensible default round rules so that I can start without configuring anything.**
- Given a new room, Then settings are `startSeconds` 30, `correctBonus` 5, `wrongPenalty` 3, `maxSeconds` 120.
- Given any clock change, Then a team's time never exceeds `maxSeconds` x 1000 ms and never goes below 0.

**FR-03 (Should): As an organiser, I want to change banks and school stage so that questions fit my audience.**
- Given a room, When I toggle banks, Then at least one bank must stay selected ("لا بد من بنك واحد على الأقل").
- Given a stage change, Then `difficulty` is one of `primary` (ابتدائي), `middle` (متوسط), `secondary` (ثانوي), `university` (جامعي); an unknown value falls back to `middle`.
- Given the change, Then it applies to questions dealt from then on (queues already built per team are not rebuilt until exhausted).

**FR-04 (Should): As an organiser, I want the player, display and organiser links (and a QR on the display) so that I can invite people and recover my session.**
- Given a room, Then the links are `/play?code=CODE`, `/display?code=CODE` and `/admin?code=CODE&key=ADMINKEY`, each copyable.
- Given the organiser loses the page, When he opens the organiser link, Then he re-enters the same room with the same state.

### 4.2 Joining and rejoining

**FR-05 (Must): As a team, I want to join with the room code and a team name so that I can play.**
- Given a valid code (case-insensitive), When I submit a name, Then I receive `teamId`, `token` and my state, and the session is stored on the device.
- Given an unknown code, Then the answer is "رمز الغرفة غير صحيح".
- Given the home page code field, Then it accepts only A-Z/0-9, upper-cased, up to 6 characters, and the Enter button is enabled from 4 characters.

**FR-06 (Must): As an organiser, I want team names to be valid and unique and the room capacity capped so that the room stays orderly.**
- Given an empty name, Then "اكتب اسم الفريق".
- Given a name longer than 24 characters, Then it is trimmed to 24.
- Given a name already used in the room by another device, Then "الاسم مستخدم، اختر اسماً آخر".
- Given 200 teams (`MAX_TEAMS`) already in the room, Then a new team gets "الغرفة ممتلئة، راجع المنظّم".

**FR-07 (Should): As a returning player, I want to get my team back by entering the same name from the same device so that losing my session does not cost my points.**
- Given a team whose `deviceId` (first 64 chars of the client device id) and name match, When `team:join` is sent, Then the existing team is reattached with `resumed: true` and score, cards and place intact.
- Given another device uses that name, Then it is rejected as taken.

**FR-08 (Must): As a player on a weak network, I want to be reattached automatically after a drop so that my clock and answers are not lost.**
- Given the socket handshake carries `auth.team {code, teamId, token}` that matches, Then the server attaches the team before processing any event and sends `session:resumed` with team and room state.
- Given a wrong token or a missing room, Then `session:invalid` is sent with an explicit message; the session is cleared only on that message, never on a timeout.
- Given a team has several sockets (two tabs), When one closes, Then the team stays `connected` while at least one socket remains.
- Given the page returns from sleep, Then the client calls `session:sync` and gets full state.
- Given an answer pressed during a drop and sent after reconnection, Then it is counted if still valid; a duplicate answer is answered `stale` and not counted twice.

**FR-09 (Must): As an organiser or display, I want to attach to a room by code so that I can see and control it.**
- Given `admin:join` with the right `adminKey`, Then control events are accepted; with a wrong key the answer is "مفتاح المسؤول غير صحيح".
- Given an `admin:*` event from a socket that is not an authenticated admin, Then it is refused ("غير مصرح") or ignored.
- Given `display:join` with an existing code, Then the display gets the public state; an unknown code gives "الغرفة غير موجودة".

**FR-10 (Should): As an organiser, I want to remove a team so that I can clear a duplicate or intruder.**
- Given a team, When I remove it, Then that device receives `team:removed`, the team disappears from the room, other teams' shop rival lists shrink by one, and round history shown to others omits the removed team (history is kept in memory and on disk).

### 4.3 Rounds and the clock

**FR-11 (Must): As an organiser, I want to start a round so that all teams play together.**
- Given at least one team and status `lobby` or `ended`, When I press start, Then status becomes `countdown` for 3000 ms, every team is reset to `startSeconds`, card effects bought for this round are applied, each team gets a first question, and `room:started` is emitted.
- Given zero teams, Then the answer is "لا يوجد فرق بعد".
- Given status `countdown`, `running` or `paused`, Then start is refused and nothing is wiped.
- Given status `finished`, Then start is refused (only "restart game" leads out of it).
- Given start after `ended`, Then the round number increments by one.
- Given the first start of the room, Then `startedAt` is recorded (room duration is measured from first start, not from creation).

**FR-12 (Must): As a team, I want my clock to move with my answers so that the game rewards knowledge.**
- Given status `running` and a question displayed, When I answer correctly, Then my time increases by `correctBonus` (5 s, capped at 120 s) and I get the next question.
- Given a wrong answer, Then my time decreases by `wrongPenalty` (3 s, floored at 0) unless a shield absorbs it, and I get the next question.
- Given an answer for a question id that is not my current question, or while I am flatlined, frozen (`lockedMs` > 0), or the room is not running, Then it is rejected as stale and my state is re-sent.
- Given the answer reply, Then it carries `isCorrect` and the correct option index of that question only after I answered; the correct index is never in room or team state before the round ends.
- Given time passes, Then every clock decreases only on the server tick (250 ms); the browser interpolates but decides nothing.

**FR-13 (Must): As a team, I want varied, fair questions so that the game stays interesting.**
- Given a team's queue, Then questions come from the room's selected banks, ordered by the stage mix (weights easy/medium/hard): primary 70/30/0, middle 45/45/10, secondary 20/60/20, university 10/40/50 (each sums to 100). The mix is a weighting by credit scheme, not a filter; a zero tier is deferred, not removed.
- Given a team has seen a question, Then it is not repeated until the pool is exhausted for that team, then the seen list is cleared.
- Given each dealing, Then options are shuffled and the answer index corrected; the same correct position does not repeat in consecutive questions where avoidable.
- Given the question has a `flag`, Then it is sent to the team with the question.

**FR-14 (Must): As an organiser, I want the first flatline to end the round for everyone, fairly.**
- Given a team reaches 0 ms, Then it is not flatlined immediately; a grace of 1500 ms (`FLATLINE_GRACE_MS`) applies in which an answer pressed before zero (client reports `left` > 0) is still counted, and an answer with `left` = 0 is rejected.
- Given grace elapses with the team still at 0, Then it is flatlined and the round ends once; all teams reaching 0 in the same tick are all flatlined.
- Given a round ends, Then status is `ended`, `room:ended` is emitted, the result is pushed to everyone and the round is recorded in history once (never twice).

**FR-15 (Must): As an organiser, I want a disconnected team not to end the round for everyone so that a Wi-Fi blip does not ruin the round.**
- Given a team has had no live socket for more than 3000 ms (`OFFLINE_AFTER_MS`) and its clock reaches 0, Then it is stopped and marked `dropped`, the round continues for the others, it receives its answer points but no multiplier, and it is not named among those who ended the round.
- Given every active team is stopped, Then the round ends.
- Given a team is offline, Then its clock keeps running (no clock freeze by cutting the network).

**FR-16 (Must): As an organiser, I want to pause and resume the round so that I can handle interruptions.**
- Given status `running`, When I pause, Then status is `paused` and clocks stop completely.
- Given `paused`, When I resume, Then status is `running`, elapsed paused time is ignored, and the flatline grace of dying teams restarts from zero.
- Given settings changes, Then `admin:updateSettings` is refused while status is `running`.

**FR-17 (Should): As an organiser, I want to restart the current round from its start so that a technical fault does not ruin it.**
- Given status `paused`, When I press "أعِد الجولة", Then clocks, answers, question queues and card effects are reset to a fresh countdown (3000 ms), the round number does not advance, no history row is written, and the card effects bought for the round (extra time, freeze, etc.) are applied again.
- Given any other status, Then the answer is "أوقف الجولة أولاً ثم أعِدها" and the button is disabled in the UI.

**FR-18 (Should): As a team, I want a correct answer that was in flight when the round ended to still count so that network lag does not punish me.**
- Given the round ended less than 1000 ms ago (`LATE_ANSWER_MS`), the team is not flatlined, not waiting, has not used its late answer, and the question id matches my current question, When I answer, Then it is accepted once per round; if correct, +1 x my multiplier is added to my score and my round award.
- Given a late answer is wrong, then it is recorded in the review and no time or points change.
- Given a second late answer or one after 1000 ms, Then it is rejected.

**FR-19 (Must): As a player joining mid-round, I want to be registered and wait for the next round so that I am not rejected.**
- Given status is `countdown`, `running` or `paused`, When a team joins, Then it is accepted with `waiting: true`: no question, clock does not run, no round award and not counted in ranks.
- Given the next round starts, Then `waiting` clears and the team plays.
- Given the play screen, Then a waiting team sees a "wait for next round" screen.

**FR-20 (Should): As an organiser, I want to add or remove 5 seconds for a team so that I can compensate for faults.**
- Given a non-flatlined team, When I press +5 or -5 s, Then its time changes by that amount within 0 and `maxSeconds`.

**FR-21 (Could): As an organiser, I want to add or remove one point for a team so that I can correct scores.**
- Given a team, When I press +1 or -1, Then its score changes by 1 and never goes below 0; the minus button is disabled at 0.

### 4.4 Scoring

**FR-22 (Must): As a team, I want round points that reward both knowledge and survival.**
- Given a round ends, Then points for a team that played = (rank points + number of correct answers in the round) x multiplier.
- Given N teams that played (waiting teams excluded), Then rank cap = min(5, N - 1) and survivors sorted by remaining time get cap, cap-1, ... with a floor of 1 when cap > 0; the flatlined team gets 0 rank points. Ladders: 20 teams -> 5-4-3-2-1 then 1s then 0; 7 teams -> 5-4-3-2-1-1-0; 6 teams -> 5-4-3-2-1-0; 4 teams -> first gets 3; 2 teams -> first gets 1.
- Given a flatlined team, Then it still gets its correct-answer points but no rank points and no multiplier.
- Given scores, Then they are added to the cumulative score only at round end, never during the round.
- Given a round, Then the result lists each team's `points`, `base`, `correct`, `doubled`, `timeMs` and flags `top`, `flatlined`, `dropped`.

**FR-23 (Should): As a team, I want a double card to multiply my round points as a bet.**
- Given I bought "مضاعفة" for the next round and survived, Then my round points are multiplied by 2 and the display marks it doubled.
- Given I was flatlined or dropped, Then the multiplier is lost (factor 1).
- Given the round ended, Then every team's multiplier resets to 1.

**FR-24 (Should): As a team, I want to review my questions after the round so that I learn and can report mistakes.**
- Given status `ended`, Then my state includes `review`: each question in order with options, my choice, correct answer and whether I was right; during any other status `review` is null.
- Given the end message, Then it shows round points, base and whether doubled.

**FR-25 (Must): As an organiser, I want to end the game and announce the winners.**
- Given any room, When I confirm "أنهِ واعرض الأوائل", Then status is `finished`, standings are computed by total score descending then remaining time descending, with ranks, and `room:finished` is emitted.
- Given `finished`, Then no new round can start and the shop is closed.

**FR-26 (Should): As an organiser, I want to restart the game in the same room so that I can run another game with the same teams.**
- Given `finished`, When I hold the "بدء من جديد" button, Then round = 1, status `lobby`, history and standings cleared, scores 0, seen questions cleared, card uses cleared, pending purchases and multipliers cleared; teams remain; the owner's room statistics (`playedRounds`, served questions) are not reset.
- Given restart, Then no round starts automatically.

### 4.5 Card shop

Card catalogue (from `CARDS` in `server/game.js`; limit is per team for the whole game):

| id | Name | Price | Limit | Effect in next round |
|---|---|---|---|---|
| time | وقت إضافي | 6 | 4 | +10 s starting time (stackable; clamped to max) |
| truce | هدنة | 3 | 2 | Clock does not drain for the first 10 s |
| shield | درع | 2 | 3 | Absorbs the next 2 wrong answers (no time loss) |
| revive | صاعق القلب | 7 | 1 | Once, when time hits 0 the clock returns to 10 s |
| fort | حصن | 5 | 3 | Blocks all attack cards aimed at me |
| mirror | مرآة | 5 | 2 | Reflects an attack back to the attacker |
| blackout | تعتيم | 4 | 3 | Target (another team): its clock is hidden from it, the display and the organiser panel |
| freeze | تجميد | 3 | 3 | Target cannot answer for 5 s at round start (clock keeps running); lock total capped at 10 s; the target sees who froze it |
| steal | سرقة نبض | 4 | 2 | Moves up to 5 s from target to me; the target is never taken below 10 s |
| double | مضاعفة | 6 | 2 | Round points x2 |

**FR-27 (Must): As a team, I want to buy cards with my points between rounds.**
- Given status `ended`, When I buy a known card I can afford and have uses left, Then points are deducted immediately, the use counter increments and the purchase is queued for the next round.
- Given any other status, Then "الشراء متاح بين الجولات فقط"; unknown card "بطاقة غير معروفة"; limit reached "استنفدت هذه البطاقة"; not enough points "نقاطك لا تكفي".
- Given a non-stackable self card (everything except `time`) already bought for the next round, Then "اشتريتها للجولة القادمة".
- Given a targeted card, Then the target must be another team ("اختر لاعباً آخر") and the same card on the same target twice in one interval is refused.
- Given the shop state, Then it lists each card's price, remaining uses, affordability, bought count, and the rival list only while the shop is open.

**FR-28 (Should): As a team, I want to undo a purchase before the round starts so that a mis-tap in a dark hall is not costly.**
- Given status `ended` and I bought card X this interval, When I refund X, Then the latest such purchase is removed, its price is returned and the use counter decrements.
- Given I have not bought X this interval, Then "لم تشترِ هذه البطاقة في هذه الفترة"; outside `ended` "النقض متاح بين الجولات فقط".
- Given the next round started, Then refund is no longer possible.

**FR-29 (Must): As a team, I want self-buff cards to take effect at round start.**
- Given I bought time x2, Then my starting time is 30 + 20 s (clamped to 120).
- Given shield, Then two wrong answers cost no time and the third costs 3 s.
- Given truce, Then my clock does not drain for the first 10 s of running time, then drains normally.
- Given revive, Then at 0 ms (by drain or by a wrong answer) my clock becomes 10 s once, the round does not end, and I get a notice; a second zero flatlines me.

**FR-30 (Must): As a team, I want attack cards to hit my chosen rival at round start.**
- Given I bought freeze on B, Then at round start B cannot answer for 5 s and sees my team name; two freezers give 10 s (the cap) and the names are joined.
- Given blackout on B, Then B's clock is hidden from B, from the display and from the organiser for that round, and B gets a notice naming me.
- Given steal on B, Then I gain min(5 s, B's time - 10 s) (never negative) and B loses the same; if nothing can be taken, I get "لم يبقَ عند B ما يُسرق".
- Given the countdown and running phases, Then the display shows the card events; outside them it shows none.

**FR-31 (Should): As a team, I want fort and mirror to defend me.**
- Given B has fort, Then every attack on B is blocked, both sides are told, and nothing is reflected.
- Given B has mirror, Then the attack applies to the attacker instead (and the attacker is told who reflected it); if the attacker has fort it blocks the reflected attack; two mirrors reflect only once (no loop).

**FR-32 (Could): As an organiser, I want to reopen cards so that teams can buy them again.**
- Given a room, When I press reset cards, Then every team's card use counters are cleared and a note confirms.

### 4.6 The display

**FR-33 (Must): As the hall, I want a lobby screen with the room code, a QR code and the joined teams.**
- Given status `lobby`, Then the display shows the code, a QR for `/play?code=CODE` and the team list; a phone layout variant exists.

**FR-34 (Must): As the hall, I want a live board of every team's lane during the round.**
- Given `countdown` the display shows the countdown; given `running`/`paused`/`ended` it shows each team's lane, time, answered/correct counts, frozen/shield/double/blackout markers, offline and waiting states, and the leader.
- Given a blacked-out team, Then its time shows "؟" and it is excluded from leader highlighting.
- Given a waiting team, Then its time shows "-" and it is listed last.
- Given the board is fixed-size (1440x900 virtual board), Then it scales to the screen.

**FR-35 (Should): As an organiser, I want to blur the display ranking so that I can build suspense.**
- Given I toggle blur, Then `displayBlurred` flips, the board is blurred and non-interactive and the state persists in the room snapshot.

**FR-36 (Should): As the hall, I want card events announced at round start.** (Covered by FR-30 criteria; the display lists blocked/reflected/hit events during `countdown` and `running`.)
- Given events exist, Then each shows kind (hit, blocked, reflected), card, attacker and target.

**FR-37 (Must): As everyone, I want final standings.**
- Given `finished`, Then display, organiser and each team see the standings (rank, name, score).

### 4.7 Reports and feedback

**FR-38 (Should): As a player, I want to report a bad question after the round.**
- Given status `ended` and a question in my review, When I choose a reason (الإجابة خاطئة, السؤال غامض, مكرّر, صعب جداً, خطأ إملائي) with an optional note, Then a report is stored with room, question, reason (max 40 chars), note (max 300 chars) and role `player`.
- Given a question id that was not served in this room, Then "هذا السؤال لم يُعرض في هذه الغرفة".
- Given a storage failure, Then the player gets an explicit failure message and no success.
- Given a player report, Then the question is not marked in the organiser's feed.

**FR-39 (Could): As an organiser, I want a feed of served questions with their answers and stats, and to report one.**
- Given I am attached as admin, Then I receive `admin:feed`: the last 60 served questions (newest first) with options, correct index, level, shown/right/wrong counts and `reported`; the feed is sent only when it changed and only on the admin channel.
- Given I report a question, Then it is stored with role `admin`, marked reported in my feed and cannot be reported twice by me.

**FR-40 (Could): As an organiser or player, I want to leave a rating and comment on the game.**
- Given a rating 1-5 and/or text (max 1000 chars), When I send it, Then it is stored once per session; a second send gives "وصلنا رأيك، شكراً لك".
- Given neither rating nor text, Then "اختر تقييماً أو اكتب رأيك".
- Given a player, Then the comment carries the team name; for an organiser the room name.

**FR-41 (Could): As an organiser, I want keyboard shortcuts.**
- Given focus not in a text field and no Ctrl/Meta/Alt pressed, When I press Space, Then a running round pauses and a paused round resumes; when I press Enter in lobby/ended/finished, Then the round start is requested.

### 4.8 Owner console

All `/api/console/*` routes require header `x-nabda-key` (URL-encoded) equal to `NABDA_OWNER_KEY`; sub-pages: اللوحة (home), البنوك (الأسئلة, إضافة سؤال, البلاغات, الأسئلة المحرَّرة, إدارة البنوك), الغرف, التعليقات.

**FR-42 (Must): As the owner, I want the console locked behind a secret key.**
- Given a wrong or missing key, Then 401 "مفتاح غير صحيح"; after more than 5 failed attempts in 60 s from one IP, Then 429 "محاولات كثيرة، انتظر دقيقة".
- Given the key is compared in constant time and read at each request, Then changing `NABDA_OWNER_KEY` in `.env` takes effect without restart.
- Given `NABDA_OWNER_KEY` unset, Then a random key is generated at boot and printed in the server log.
- Given a correct key, Then the browser stores it in localStorage and signs out on a 401.

**FR-43 (Should): As the owner, I want a dashboard.**
- Given the dashboard, Then it returns totals (rooms, players, rounds, questions served, bank size, comments, average stars, median played time), 14 days of daily rooms/players, per-bank health (total, per-level counts, seen, correct rate, reports), the six worst questions (shown at least 3 times, sorted by reports then lowest rate), the last 5 rooms and last 4 comments, plus the audit counters (errors, warnings, duplicates).
- Given the sidebar badges, Then they use the same computation as the dashboard (pending, pending-ready, reports, unread comments/reports, weak questions = shown >= 3 and correct rate < 30%, low stars <= 2, edits, live rooms).

**FR-44 (Should): As the owner, I want to see and delete rooms.**
- Given the rooms list, Then it can filter by `days`, `from`/`to`, or `all=1`; default window is 60 days.
- Given a room code, Then the detail returns the room record, per-question stats share and `live` flag; unknown gives 404.
- Given a room that is live (in memory and not `finished`), When I delete it, Then 409 "الغرفة تعمل الآن، أنهِ المسابقة ثم احذفها".
- Given a finished room, When I delete it, Then the record is removed from the database and from memory and does not reappear.

**FR-45 (Should): As the owner, I want to browse questions with their live stats.**
- Given a bank id or `all`, Then each question has id, bank, text, options (correct first), level, flag, shown/correct/wrong/rate, report count and audit issues; unknown bank 404.
- Given the views, Then filters exist: الكل, ما قِيس, لم تُعرض بعد, ضعيفة الصواب, مُبلَّغ عنها, عليها ملاحظات; and a level filter (سهل/متوسط/صعب).

**FR-46 (Should): As the owner, I want to add and edit questions with immediate validation.**
- Given a question body, Then it is rejected with 400 and issues when it has any audit error: empty text; options not exactly 4; empty option; duplicate options (after normalisation); correct answer not first; level not 1, 2 or 3; a wrong option equal to the correct one.
- Given warnings (text under 8 chars, tell-tale words like "فقط", "عليه السلام", "دائماً" in only the correct or only one wrong option, correct option 12+ chars longer than the longest wrong), Then the save succeeds and warnings are returned.
- Given the text or options of a saved question changed, Then its stats and reports are cleared, the old version is archived in edits (30 days) and a new id exists.
- Given only the level changed, Then stats are kept.
- Given I move a question to another bank without changing the text, Then its stats and reports move with it; with changed text they are cleared and archived.
- Given the move would leave the source bank empty, Then 400 "لا يُترك البنك فارغاً"; given the same text already exists in the target, Then 400 "في البنك الهدف سؤالٌ بالنصّ نفسه".
- Given a live check call, Then `/api/console/check` returns the issues without saving.

**FR-47 (Should): As the owner, I want to delete a question with a way back.**
- Given a question, When I delete it, Then it is removed, its stats cleared and an archive row of kind `delete` is recorded.
- Given it is the last question in a bank used by a room in memory, Then 400 naming the room codes; otherwise a bank may be emptied.

**FR-48 (Should): As the owner, I want to create a bank.**
- Given a name and an id, Then the id must be Latin letters, digits and hyphens, and unique; the name must be non-empty and unique (comparison tolerant of Arabic diacritics); violations give 400 with the reason.
- Given a new bank, Then it is created empty, active, and hidden from room creation until it has at least one question.

**FR-49 (Should): As the owner, I want to deactivate a bank without deleting it.**
- Given an active bank, When I deactivate it, Then it is hidden from room creation (`/api/banks` returns only active banks with questions) but stays in the console with its questions, stats and reports, readable and editable, with a lock icon.
- Given a bank used by a room in memory, Then deactivation is refused with 400 naming the rooms. Reactivation is always allowed.

**FR-50 (Should): As the owner, I want to delete a bank into a 30-day trash.**
- Given a bank, When I long-press delete, Then it is archived with all its questions first, then deleted.
- Given it is the last bank, or is used by a room in memory, Then 400 ("لا يُحذف آخر بنك" / "البنك مستعملٌ في غرفة: CODES").
- Given a delete failure after archiving, Then the archive row is removed.

**FR-51 (Could): As the owner, I want to restore or forget trashed banks.**
- Given the trash, Then it lists up to 100 banks deleted in the last 30 days with question count and whether restorable (not currently existing).
- Given restore, Then the bank returns with its questions and the trash row is removed; given forget, Then the row is removed permanently.
- Given a trash item older than 30 days, Then it is swept (daily).

**FR-52 (Should): As the owner, I want to stage questions in a pending area.**
- Given text and a correct answer (the only mandatory fields), Then a pending row is created; empty text gives "نصّ السؤال فارغ", empty answer "الإجابة الصحيحة فارغة", unknown bank "بنك غير معروف".
- Given digits, Then Western digits are converted to Arabic-Indic in question, answer and wrong options; at most 3 wrong options are kept.
- Given a pending row, Then it is never visible to players.

**FR-53 (Should): As the owner, I want to import a batch by paste or CSV with a preview.**
- Given the import text (max 100,000 characters, max 500 rows), Then each line is a question and its answer separated by Tab, comma or `|`; optional columns are three wrong options then a level (`1/2/3`, `١/٢/٣` or سهل/متوسط/صعب); a header row is skipped.
- Given `dry: true`, Then nothing is written and the response lists the understood rows (with duplicate markers evaluated against banks and already pending rows), the skipped rows with reasons and the row limit.
- Given a real import, Then rows are stored with source `paste` or `csv` and the selected bank if valid.

**FR-54 (Should): As the owner, I want to complete pending rows step by step and discard them.**
- Given a pending row, When I save, Then the full state is overwritten (same validations as FR-52) and the existing flag is kept if none is sent.
- Given an unknown pending id, Then 404 "لا سؤال معلَّقٌ بهذا الرقم".
- Given delete, Then the row is removed.

**FR-55 (Must): As the owner, I want only complete, valid questions to reach a bank.**
- Given a pending row missing the bank, fewer than 3 wrong options or a valid level (1-3), Then it is "ناقص" and approval returns 400 "ناقص: ...".
- Given a complete row with an audit error, Then approval is refused with the error message; warnings do not block.
- Given approval, Then the question is written to the bank (correct option first) and then removed from pending (in that order).
- Given a duplicate (same normalised text and flag in a bank or an earlier pending row), Then it is flagged with its origin but not blocked.

**FR-56 (Should): As the owner, I want to approve all ready rows at once.**
- Given the call, Then every ready row (optionally only those of one bank) is approved; incomplete rows stay; failures are returned with reasons; the response gives the `approved` count and the `failed` list.

**FR-57 (Could): As the owner, I want an edits history with restore for 30 days.**
- Given the list, Then up to 300 entries from the last 30 days with bank name and `restorable` (the old question id does not currently exist).
- Given restore of an edit, Then the old text replaces the new version if it still exists, otherwise is appended; stats do not return; the history row is removed. Restore of a delete re-adds the question. If the question already exists, 400 "السؤال موجودٌ أصلاً".
- Given forget one or forget all, Then only history rows are removed; banks are untouched.

**FR-58 (Could): As the owner, I want a duplicate and quality audit across banks.**
- Given `/api/console/duplicates`, Then duplicates are pairs of identical normalised text (diacritics, punctuation and hamza variants ignored; text with different flags is not a duplicate) across or within banks.
- Given the repository tests, Then the shipped banks have no errors, no tell-tale warnings and no duplicates.

**FR-59 (Could): As the owner, I want reports and comments in one inbox.**
- Given the feed list, Then up to 400 items filterable by kind (report/comment), source role, unread, text, low stars; "mark all read" can target a kind or all.

### 4.9 Operations and resilience

**FR-60 (Must): As the operator, I want to know whether anyone is playing before I deploy.**
- Given `GET /api/live`, Then it returns `live`, `rooms`, `players`, `connected` and an `instance` id; a room counts as live only when mid-round (`countdown`, `running`, `paused`) and at least one team is connected; counts only, no names; `Cache-Control: no-store`.
- Given `GET /api/health`, Then it returns `{ok: true, rooms: n}`.
- Given the pre-push hook is installed (`npm run hooks`), Then a push is blocked during a live round unless `--no-verify`.
- Given two different `instance` ids across calls, Then more than one instance is running (a misconfiguration).

**FR-61 (Could): As the operator, I want to pull live banks into the repository for a readable backup.**
- Given `npm run pull-banks` (with `--dry`, `--delete-missing`, `--minus-archive`), Then the live banks are written to `server/banks/*.json` in the seed format (correct option first); files are only a seed and backup, never re-imported.

**FR-62 (Must): As an organiser, I want my room to survive a server restart.**
- Given a running server, Then every dirty room (and every running room) is saved every 1000 ms.
- Given a restart, Then all non-idle snapshots are restored before any connection, with the same code and admin key, and a room that was `running` or `countdown` returns as `paused`; all teams start as disconnected and their offline timer starts at boot.
- Given SIGINT/SIGTERM, Then the server tells clients `server:restarting`, flushes to the database with an 8 s deadline, closes the pool and exits.

**FR-63 (Should): As the operator, I want idle rooms cleaned up.**
- Given a room not touched for 2 hours (`IDLE_ROOM_MS` = 7,200,000 ms), Then it is marked `finished` and removed from memory every 10 minutes sweep, its live snapshot is deleted but its history record stays; idle rooms in history are closed as finished.

**FR-64 (Should): As the operator, I want stale browsers to refresh after a new deploy.**
- Given the server's `build.txt` stamp, Then it is sent on connection (`server:hello`); a client with a different stamp reloads between rounds (once per stamp, not mid-round).

## 5. Non-functional requirements

**NFR-01 Time authority.** Server is the only authority for clocks and scores. Tick every 250 ms. Browsers interpolate (`lib/clock.ts`) and never decide. Reference: tests in `rules-test`, `cards-rules-test`.

**NFR-02 Answer secrecy.** The correct answer never leaves the server before the question is answered. Room/public state carries no questions or answers; the answer index is returned only with the answer result; the full review is sent only when the status is `ended`; the organiser's question feed (which includes answer indexes) travels on a separate admin-only channel.

**NFR-03 Single instance.** Exactly one server process (live rooms are in memory). No autoscaling or replicas; the platform must support persistent processes and WebSocket (not serverless). Node >= 24. `/api/live` exposes an instance id to detect violation.

**NFR-04 Persistence.** PostgreSQL via `DATABASE_URL` is required (server will not start without it); SSL on except `PGSSL=off` or localhost. Tables: rooms, room_state, question_stats, room_question_stats, feedback, edits, banks, bank_trash, pending. The container disk is ephemeral; nothing durable may be stored on it. Banks live in the database; JSON files are seed/backup only.

**NFR-05 Weak networks.** Socket ping interval 20 s, ping timeout 25 s (total 45 s, under the 60 s proxy timeout); message compression above 1 KB; identity sent in the handshake; no session is deleted on timeout; offline means no socket for more than 3 s; tab sleep recovered by `session:sync`; answers acknowledged (`stale` replies for duplicates).

**NFR-06 Broadcast load.** Time is not broadcast; team state is sent on change; room state to organiser/display at most every 250 ms; to players between rounds at most every 1000 ms; round transitions immediately; a full resync every 5 s while running. Test target: a quiet phone gets under 8 KB during a round with 30 players; the organiser panel receives at most 4 batches per second.

**NFR-07 Abuse guard.** Per-connection token bucket: burst 20 events, refill 10 per second; excess events are dropped silently. Incoming message cap 100,000 bytes; JSON body cap 256 KB; owner key throttle 5 failed attempts per minute per IP.

**NFR-08 Capacity.** Up to 200 teams per room (`MAX_TEAMS`); tested with 30 concurrent teams.

**NFR-09 Languages.** Arabic only, RTL. Question digits normalised to Arabic-Indic in the pending flow. Room/team names may contain any characters; HTML-escaped when injected into link-preview metadata.

**NFR-10 Devices.** Team: phones (one device per team, wake lock requested to keep the screen on). Display: projector/large screen with a scaled fixed board and a phone layout. Organiser: laptop (keyboard shortcuts) and phone. Owner console: any device.

**NFR-11 Accessibility and motion.** Reduced-motion preference is honoured (home page animations, haptics); dark theme default with a light theme toggle stored in localStorage; sound mute stored in localStorage. No other accessibility target is specified (see Open questions).

**NFR-12 Security.** Owner key via header, constant-time comparison, decoded from URL encoding; admin key per room (UUID) required for admin events; team token (UUID) required to rejoin; unexpected errors return a generic message (details only in the server log); unhandled async route errors do not crash the process. CORS allows any origin on Socket.IO.

**NFR-13 Privacy.** Personal data collected: team names, a device id, free-text feedback, no accounts, phones or emails. Any named person in a team name or comment is personal data under Saudi PDPL; no consent text, retention policy or deletion flow exists (see Open questions). Link-preview metadata includes only the room code, not the admin key.

**NFR-14 Data retention.** Live snapshots: deleted when a room is idle-swept. Room history and statistics: kept (the record is not deleted by the sweep). The owner rooms list defaults to a 60-day window. Edits archive and deleted banks: 30 days, swept daily. Feedback and reports: no sweep in code.

**NFR-15 Deployment.** Hosted on CranL; every push to `main` auto-deploys, restarts the server and pauses any live round. Build `npm run build`, start `npm start`, health check `/api/health`. Environment: `DATABASE_URL` (required), `NABDA_OWNER_KEY` (set it), `PORT`, `PGSSL=off` (local only). A live-round guard: `npm run live` and `.githooks/pre-push` (installed with `npm run hooks`; override `--no-verify`).

**NFR-16 Caching.** Hashed `/assets/*` cached one year immutable; other static files 1 hour; `index.html` and `/api/live` never cached.

**NFR-17 Browsers.** Not specified. The stack assumes modern browsers (React 19, Vite, Tailwind v4, Web Audio, optional Wake Lock and Vibration APIs).

**NFR-18 Testability.** Plain Node test scripts in `client/*.mjs`: `env-test`, `rules-test`, `memory-test`, `cards-test`, `cards-rules-test`, `flags-test` (no server needed except a test DB for memory), `e2e`, `net-test`, `grace-test` (need the server on :3000). `memory-test` refuses any database whose name lacks "test".

**NFR-19 Graceful degradation.** Failed persistence of a room is retried on the next 1 s cycle; failed feedback storage is reported to the sender, not swallowed; a room that cannot be restored is logged and skipped.

## 6. Integrations

| Integration | Use | Needed from the client |
|---|---|---|
| PostgreSQL (managed, same region) | All persistence | `DATABASE_URL` provided by the platform (CranL). |
| CranL hosting | Auto-deploy from `main`, WebSocket, one instance | Account/project access, confirmation of single replica, domain. |
| Socket.IO | Real-time channel | None. |
| QR generation (`qrcode`, client-side) | Display lobby join QR | None. |
| Link preview (Open Graph) | Rich preview when sharing `/play?code=` | Domain; images `og.png`, `og-play.png` exist. |
| GitHub repository | Source, seed banks, deployment trigger | Repo access. |

No payment, SMS, email, maps or third-party auth integrations exist.

## 7. Content and assets needed from the client

- Question content per bank, written correct-first with 3 wrong options and a level 1-3 (templates in `templates/`, CSV/paste import).
- Bank art: an image named after each bank id in `client/public/art/` (a new bank uses `other` until added).
- Optional country-flag questions use a `flag` code.
- Logo/wordmark and link-preview images already in the repository (`og.png`, `og-play.png`, `trace.svg`).
- Production domain and CranL access; `NABDA_OWNER_KEY` value chosen by the owner.
- Credit text "تم إنشاء الموقع بواسطة مشعل الجلال" is shown in the footer.

## 8. Open questions

### Blocking (documentation integrity only, development is not blocked)
1. **Card catalogue mismatch.** README and CLAUDE.md describe three cards (وقت إضافي price 3 limit 4, تجميد price 4 limit 4, مضاعفة price 6 limit 2) while the code defines ten cards with different numbers (time 6/4, freeze 3/3, double 6/2, plus truce, shield, revive, fort, mirror, blackout, steal). The code comment in `CARDS` still discusses only time, freeze and double pricing. Which is intended for the client-facing description? This baseline follows the code; if the README numbers are the intended design, the code needs changing instead.

### Non-blocking
2. Round parameters (`startSeconds`, bonus, penalty, max) and `admin:newRound` exist on the server but no screen uses them, while the home page hard-codes "ثلاثون ثانية", "+٥" and "-٣". Is a settings UI wanted, or should the server handler be removed?
3. `admin:updateSettings` is blocked only while `running`; during `countdown`, `paused` or `ended` it resets every team's per-round state (time, question, answers, active card effects). Is that intended?
4. Room history retention: README/PLAN say 60 days, but `sweepOld` no longer deletes rooms (only edits and trash at 30 days); the console list defaults to 60 days and `all=1` shows everything. Is indefinite retention of room history intended, and what retention applies to feedback and reports (none in code)?
5. PDPL: team names, device ids and comments are stored with no consent notice or deletion route. Does the client require a notice or retention limit?
6. `admin:adjustScore` and `admin:adjustTime` have no per-call limits and the organiser can adjust scores at any time (including during a round). Intended?
7. A dropped (offline) team still receives points for its correct answers but loses the multiplier. Confirm this rule with the client.
8. After a restart, rooms return paused with every team counted offline from boot; if the organiser resumes before players reconnect (3 s window), those teams hitting zero are dropped without ending the round. Is a longer reconnection allowance after boot desired?
9. CORS is open (`origin: '*'`) and the organiser key travels in the URL query of the organiser link. Is that acceptable for the client's threat model?
10. Is an organiser's room limited per owner (no cap on number of rooms created or on idle rooms before the 2 h sweep)?
11. The last question of a bank can be deleted (leaving an empty bank) when no room uses it, while README says nothing and the move rule forbids emptying a bank. Intended asymmetry?
12. Reports and comments have no owner reply, status (resolved) or assignment beyond read/unread. Needed?
13. Browser/device support list and accessibility target (contrast, screen readers, text size) are unspecified.
14. Rate-limited socket events are dropped silently; a player on a very busy hall may see a frozen button. Is a visible error wanted?
15. `req.ip` for the owner-key throttle depends on the proxy configuration; behind CranL the IP may be the proxy's. Has trust-proxy been verified?

## 9. Risks and assumptions

Risks:
1. **Auto-deploy during a live round.** A push to `main` restarts the server and pauses the round. Mitigation: `npm run live`, pre-push hook (bypassable).
2. **Single instance.** Two replicas would split a room silently. Mitigation: platform setting plus the `/api/live` instance id.
3. **In-memory live state.** Up to ~1 s of a round can be lost in a crash; restore is paused only.
4. **Database dependency.** Slow or unavailable PostgreSQL delays persistence and owner features; the live game itself keeps running from memory.
5. **Missing `await` in `store.js`** silently writes nothing (documented hazard).
6. **Crowded Wi-Fi.** Many phones on weak Wi-Fi can drop; mitigated by grace windows, offline rule and compressed, batched broadcasts.
7. **Owner key leak.** One key gives full console access; there is no per-user audit.
8. **Documentation drift.** README/CLAUDE.md differ from the code (see open question 1, 4).
9. **Question quality.** Shipped quality depends on the owner; the audit catches structure and tell-tales, not factual errors.

Assumptions:
- One device equals one team; the organiser is physically present and controls the pace.
- The hall has internet access; the projector device opens `/display`.
- The owner is a single trusted person.
- Arabic-only audience; stage mixes target Saudi school levels.
- The seeded `server/banks/*.json` exist only for first boot on an empty database.

## 10. Priority (MoSCoW) for this baseline

- **Must (25):** FR-01, 02, 05, 06, 08, 09, 11, 12, 13, 14, 15, 16, 19, 22, 25, 27, 29, 30, 33, 34, 37, 42, 55, 60, 62.
- **Should (29):** FR-03, 04, 07, 10, 17, 18, 20, 23, 24, 26, 28, 31, 35, 36, 38, 43, 44, 45, 46, 47, 48, 49, 50, 52, 53, 54, 56, 63, 64.
- **Could (10):** FR-21, 32, 39, 40, 41, 51, 57, 58, 59, 61.
- **Won't (this version):** the out-of-scope items 1-13 in section 2 (notably English UI, accounts, payments, multi-instance, settings UI, auto-resume after restart).

Total: 64 functional requirements, 19 non-functional requirements.

## 11. Recommendations (optional, not part of the baseline)

- Update README/CLAUDE.md card tables to the 10-card catalogue (or decide the intended set).
- Surface a "connection lost" hint when events are rate-limited.
- Add a retention policy for feedback and a short privacy notice for team names.
- Consider an extended offline allowance for the first seconds after a restart.
- Consider a console session audit log if more than one person will use the owner key.

## 12. Change request CR-01: landing page rework (`/`, `client/src/pages/Home.tsx`)

Status: REQUESTED by the owner on 2026-10-10. Local only, no push. Not yet built.

Owner request (Arabic): "عدل على الصفحة التعريفية بشكل كامل، ماودي المنظم يقعد ينزل للاخير عشان ينشئ غرفة، وابيك تعطيني تنظيم مختلف تماما لفكرة الشرح، ابيها اكثر تفاعلا. لا تسوي بوش، خليه لوكال. ابدع."

Meaning: the organiser must not scroll to the bottom to create a room (today the create/display cards sit below the four rules, `Home.tsx` "seat" cards); the how-to-play explanation gets a completely different, much more interactive structure.

### 12.1 Baseline items this change supersedes

| Baseline item | Status |
|---|---|
| Section 3, Visitor role: "Read the four rules" | SUPERSEDED by FR-67 to FR-70 (practice round and cards replace the rules). |
| Section 3, Visitor role: "navigate to join/display/create" (entry cards at the bottom of the page) | SUPERSEDED by FR-65 (placement of entry points). |
| FR-05, third bullet (home code field: A-Z/0-9, upper-cased, max 6, enabled from 4 characters) | KEPT unchanged; restated in FR-66 so the new layout cannot lose it. |
| NFR-11 "home page animations honour reduced motion" | KEPT and extended to the demo by FR-72. |
| Open question 2 (home hard-codes "ثلاثون ثانية", "+٥", "-٣") | SUPERSEDED by FR-71: the demo takes its numbers from one client constant block matching the server defaults. |
| FR-01 to FR-04 (`/admin`), FR-33 to FR-37 (`/display`), `/play` | NOT affected. Only links to them change position. |

### 12.2 Functional requirements

Priority tags are MoSCoW. Demo numbers: start 30 s, correct +5 s, wrong -3 s, max 120 s (as FR-02). Card values as the table in 4.5.

**FR-65 (Must): As an organiser or visitor, I want join, create room and open display reachable in the first screen so that I never scroll to start.**
- Given a phone viewport of 360x640 and a desktop viewport of 1440x900, When `/` loads, Then the room-code field with its enter button, a "create room" action (to `/admin`) and an "open display" action (to `/display`) are all fully visible without scrolling.
- Given the first screen, Then "create room" is visually the primary button (filled, largest tap target among the secondary actions) and "join" is still available as the code field.
- Given any entry action, When activated, Then it navigates to `/play`, `/admin` or `/display` respectively, the same routes as today.
- Given a tap target, Then it is at least 44x44 CSS px.

**FR-66 (Must): As a player arriving with a bare link, I want to type a code and join so that I can play.**
- Given the code field, When I type, Then only A-Z/0-9 are kept, upper-cased, max 6 characters; the enter button is disabled under 4 characters and enabled from 4.
- Given a valid code, When I submit, Then I go to `/play?code=CODE` exactly as before.
- Given a phone, When the field is focused and the keyboard opens, Then the field and its button remain visible.

**FR-67 (Must): As a visitor, I want to play a practice round against bot teams so that I understand the game by doing it.**
- Given the practice area, When I press start, Then a 3 s countdown runs, then my lane starts at 30 s next to at least 3 bot lanes, each draining in real time.
- Given a question with 4 options, When I tap the correct option, Then my lane gains 5 s and the next question appears; when wrong, my lane loses 3 s (floored at 0) and the next appears.
- Given my lane changes, Then a visible "+٥" or "-٣" change marker appears on my lane (Arabic-Indic digits, no sign made with an em dash).
- Given the practice questions, Then they come from a fixed list inside the client bundle (at least 12) and the correct option position varies.
- Given the practice round is running, Then no network request is made (see FR-71).

**FR-68 (Must): As a visitor, I want to watch the round end the way it does in a real game so that I understand the "first flatline ends it for everyone" rule.**
- Given a running practice round, Then one bot (scripted, deterministic by seed per run) reaches 0 and flatlines, and every lane stops at that moment.
- Given the round ended, Then a results view shows the ranking of all lanes (me and bots) with points computed by the FR-22 rule for N teams (rank points cap = min(5, N-1), flatlined team 0, plus correct answers) and my correct-answer count.
- Given I myself reach 0 first, Then the round ends with me flatlined and the same results view appears.
- Given the results view, Then a "play again" action restarts a fresh practice round and a way back to the entry actions is visible.

**FR-69 (Should): As a visitor, I want to tap a card and see what it does on mini lanes so that I understand the shop.**
- Given the cards section, Then it lists the 10 cards of 4.5 by name and price (no limit text required).
- Given I tap a card, Then a mini lane scene (me plus one rival) animates that card's effect from the 4.5 table: e.g. time +10 s on my lane, freeze locks the rival 5 s, steal moves 5 s from rival to me, shield absorbs a wrong answer, fort blocks and mirror reflects an attack, blackout hides the rival's clock, double shows points x2, truce pauses drain 10 s, revive resets 0 to 10 s.
- Given I tap another card while one plays, Then the scene resets to its start state and plays the new card (no stacked state).
- Given the card scene, Then the numbers shown equal the catalogue values (price, seconds), taken from one constant block.

**FR-70 (Should): As a visitor, I want a clear order of experience (enter, practice, cards, enter again) so that the explanation is a path and not a wall of text.**
- Given the page, Then it has no static four-rules list; the explanation exists only as the practice round and the card scene.
- Given the visitor scrolls past the first screen, Then a create/join action stays reachable (repeat of FR-65 actions at the end of the page or a persistent bar).
- Given the page, Then no hint or caption paragraphs are added under controls (project rule), and no visible text contains an em dash.

**FR-71 (Must): As the operator, I want the demo to be fully client-side so that visitors never create load or rooms.**
- Given the practice round and the card scene run, Then no `/api/*` request, no Socket.IO event and no room creation occurs (verified by the network log showing only static assets).
- Given the demo, Then it does not import or call `lib/socket.ts`.
- Given the demo numbers (30, 5, 3, 120, card prices and effects), Then they live in one client constants block with a comment-free test or review check against `server/game.js` defaults.

**FR-72 (Must): As a user who prefers reduced motion, I want the page to work without animation.**
- Given `prefers-reduced-motion: reduce`, Then lane drain, pulses, card scene and entry animations are replaced by static or stepwise (non-animated) updates, the practice round remains fully playable and shows the same information, and nothing relies on motion alone to show a change (+٥/-٣ text remains).
- Given not reduced, Then animation is allowed but the page must not block input.

### 12.3 Non-functional requirements for this change

**NFR-20 Landing page quality.** Arabic only, RTL; works at 360 px width through desktop with no horizontal scroll; dark and light themes both usable; demo timers stop when the practice section is off-screen or the tab is hidden; no new third-party runtime library without owner approval; `npm --prefix client run lint` and `tsc -b` pass; the change stays in the local working tree (no commit to `main`, no push; `.githooks/pre-push` applies).

### 12.4 Priority for CR-01

- Must (6): FR-65, FR-66, FR-67, FR-68, FR-71, FR-72.
- Should (2): FR-69, FR-70.
- Could: none. Won't: sound in the demo, saving practice progress, real-room spectating from the landing page.

### 12.5 Open questions for CR-01

Blocking: none. All items below have a stated default and the build can start.

Non-blocking:
1. Who writes the practice questions? Default: the developer drafts at least 12 general-knowledge questions in Arabic, suitable for any stage, and the owner reviews them. Do you want them taken from a specific bank or stage?
2. Should the second primary action be "create room" in the same visual weight as "join", or is join the hero and create the primary button? Default: create room is the filled primary button, join is the code field beside it.
3. Should the demo include all 10 cards or only the 3 in README (time, freeze, double)? Default: all 10, following the code (see baseline open question 1).
4. Is a practice duration cap wanted? Default: the round ends naturally by the scripted bot flatline, within about 45 s.
5. Is a sound effect wanted in the demo? Default: none (the real game's mute setting is not applied).
6. Should the footer credit stay as is? Default: yes.

### 12.6 Risks and assumptions for CR-01

- Assumes `ROLES`/seat cards and `Reveal`/`Curtain` helpers in `Home.tsx` may be reused or removed freely.
- Demo numbers can drift from `server/game.js` later; mitigated by FR-71's single constants block.
- A larger first screen on a 360x640 phone is tight with the code field, two actions, and a demo teaser; the practice round is expected to start from a section reached by one tap or short scroll.
- Heavy animation on low-end phones: mitigated by FR-72 and NFR-20.

## Change log

- 2026-10-10: Added section 12 (CR-01): landing page rework, stories FR-65 to FR-72, NFR-20. Marks which baseline Home items are superseded (see 12.1). No code changed.

- 2026-10-10: Initial baseline created from the existing code and documents. No client change request.
