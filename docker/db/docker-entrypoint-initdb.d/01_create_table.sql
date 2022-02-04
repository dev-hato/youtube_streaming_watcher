CREATE TABLE IF NOT EXISTS channels
(
    channel_id VARCHAR PRIMARY KEY NOT NULL,
    created_at TIMESTAMP
);

INSERT INTO channels(channel_id) VALUES ('UCQ0UDLQCjY0rmuxCDE38FGg');

CREATE TABLE IF NOT EXISTS videos
(
    channel_id VARCHAR NOT NULL,
    video_id VARCHAR NOT NULL,
    created_at TIMESTAMP NOT NULL,
    PRIMARY KEY (channel_id, video_id),
    FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
);
