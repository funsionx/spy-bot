export interface BusinessConnection {
  id: string;
  user: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
    is_premium?: boolean;
  };
  user_chat_id: number;
  date: number;
  can_reply: boolean;
  is_enabled: boolean;
}

export interface BusinessMessage {
  message_id: number;
  date: number;
  chat: Chat;
  from?: User;
  text?: string;
  caption?: string;
  business_connection_id: string;
  photo?: PhotoSize[];
  video?: Video;
  audio?: Audio;
  document?: Document;
  voice?: Voice;
  video_note?: VideoNote;
  sticker?: Sticker;
}

export interface DeletedBusinessMessages {
  business_connection_id: string;
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  message_ids: number[];
}

export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  is_premium?: boolean;
}

export interface Chat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface Video {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumb?: PhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface Audio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  thumb?: PhotoSize;
}

export interface Document {
  file_id: string;
  file_unique_id: string;
  thumb?: PhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface Voice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface VideoNote {
  file_id: string;
  file_unique_id: string;
  length: number;
  duration: number;
  thumb?: PhotoSize;
  file_size?: number;
}

export interface Sticker {
  file_id: string;
  file_unique_id: string;
  type: string;
  width: number;
  height: number;
  is_animated?: boolean;
  is_video?: boolean;
  thumb?: PhotoSize;
  emoji?: string;
  set_name?: string;
  premium_animation?: any;
  mask_position?: any;
  custom_emoji_id?: string;
  needs_repainting?: boolean;
  file_size?: number;
}

export interface CachedMessage {
  message_id: number;
  text?: string;
  caption?: string;
  from?: User;
  chat: Chat;
  date: number;
  business_connection_id: string;
  photo?: PhotoSize[];
  video?: Video;
  audio?: Audio;
  document?: Document;
  voice?: Voice;
  video_note?: VideoNote;
  sticker?: Sticker;
  s3Key?: string | null;
}

export interface NotificationData {
  action: "edited" | "deleted";
  userName: string;
  userUsername?: string;
  chatName: string;
  oldText?: string;
  newText?: string;
  deletedText?: string;
}

export interface EditedBusinessMessage {
  message_id: number;
  // ... existing code ...
}
