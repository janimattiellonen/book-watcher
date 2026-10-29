-- Separate database for `npm run test:db`, so tests can truncate tables freely
-- without touching the books and listeners in the development database.
CREATE DATABASE book_watcher_test;
