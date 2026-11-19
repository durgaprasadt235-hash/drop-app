// DROP database schema — 28 tables. DDL is Postgres-flavoured; the Muse
// hosted build uses the same tables. No dummy rows are seeded.

export const TABLES = [
  'users', 'auth_identities', 'auth_sessions', 'otp_challenges',
  'follows', 'blocks', 'reports',
  'posts', 'post_likes', 'post_saves', 'post_comments',
  'post_poll_votes', 'post_question_answers',
  'stories', 'story_poll_votes', 'story_question_answers',
  'drops', 'drop_access_grants', 'drop_opens',
  'reels', 'conversations', 'conversation_members', 'messages',
  'slash_invitations', 'clubrooms', 'clubroom_members',
  'notifications', 'saved_items',
] as const;
// 28 tables. Slider ratings are stored in the poll-vote tables
// (post_poll_votes / story_poll_votes) with a rating value.
// NOTE: otp_challenges is UNUSED — phone + OTP is disabled (2026-11-19).

export const DDL = `
CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT, email TEXT UNIQUE, google_sub TEXT UNIQUE, avatar_url TEXT, bio TEXT, is_private BOOLEAN DEFAULT FALSE, auth_method TEXT NOT NULL DEFAULT 'google', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE auth_identities (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, email TEXT, UNIQUE(provider, provider_user_id));
CREATE TABLE auth_sessions (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), session_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE otp_challenges (id SERIAL PRIMARY KEY, phone TEXT NOT NULL, code_hash TEXT NOT NULL, purpose TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INT DEFAULT 0, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE follows (follower_id INT REFERENCES users(id), following_id INT REFERENCES users(id), PRIMARY KEY (follower_id, following_id));
CREATE TABLE blocks (blocker_id INT REFERENCES users(id), blocked_id INT REFERENCES users(id), PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE reports (id SERIAL PRIMARY KEY, reporter_id INT REFERENCES users(id), target_id INT REFERENCES users(id), reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE posts (id SERIAL PRIMARY KEY, author_id INT REFERENCES users(id), caption TEXT, media_url TEXT, filter TEXT DEFAULT 'original', effect TEXT DEFAULT 'none', extras_json JSONB, fire_count INT DEFAULT 0, comment_count INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE post_likes (user_id INT REFERENCES users(id), post_id INT REFERENCES posts(id), PRIMARY KEY (user_id, post_id));
CREATE TABLE post_saves (user_id INT REFERENCES users(id), post_id INT REFERENCES posts(id), PRIMARY KEY (user_id, post_id));
CREATE TABLE post_comments (id SERIAL PRIMARY KEY, post_id INT REFERENCES posts(id), author_id INT REFERENCES users(id), body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE post_poll_votes (post_id INT REFERENCES posts(id), user_id INT REFERENCES users(id), option INT NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE post_question_answers (id SERIAL PRIMARY KEY, post_id INT REFERENCES posts(id), user_id INT REFERENCES users(id), answer TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE stories (id SERIAL PRIMARY KEY, author_id INT REFERENCES users(id), media_url TEXT, filter TEXT DEFAULT 'original', effect TEXT DEFAULT 'none', extras_json JSONB, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE story_poll_votes (story_id INT REFERENCES stories(id), user_id INT REFERENCES users(id), option INT NOT NULL, PRIMARY KEY (story_id, user_id));
CREATE TABLE story_question_answers (id SERIAL PRIMARY KEY, story_id INT REFERENCES stories(id), user_id INT REFERENCES users(id), answer TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE drops (id SERIAL PRIMARY KEY, creator_id INT REFERENCES users(id), kind TEXT NOT NULL, status TEXT DEFAULT 'waiting', blast_at TIMESTAMPTZ NOT NULL, caption TEXT, media_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE drop_access_grants (drop_id INT REFERENCES drops(id), user_id INT REFERENCES users(id), PRIMARY KEY (drop_id, user_id));
CREATE TABLE drop_opens (drop_id INT REFERENCES drops(id), user_id INT REFERENCES users(id), opened_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (drop_id, user_id));
CREATE TABLE reels (id SERIAL PRIMARY KEY, author_id INT REFERENCES users(id), media_url TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE conversations (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE conversation_members (conversation_id INT REFERENCES conversations(id), user_id INT REFERENCES users(id), joined_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (conversation_id, user_id));
CREATE TABLE messages (id SERIAL PRIMARY KEY, conversation_id INT REFERENCES conversations(id), sender_id INT REFERENCES users(id), body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE slash_invitations (id SERIAL PRIMARY KEY, conversation_id INT REFERENCES conversations(id), inviter_id INT REFERENCES users(id), invitee_id INT REFERENCES users(id), status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE clubrooms (id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_by INT REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE clubroom_members (clubroom_id INT REFERENCES clubrooms(id), user_id INT REFERENCES users(id), PRIMARY KEY (clubroom_id, user_id));
CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), type TEXT NOT NULL, body TEXT NOT NULL, read BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE saved_items (user_id INT REFERENCES users(id), post_id INT REFERENCES posts(id), PRIMARY KEY (user_id, post_id));
`;
