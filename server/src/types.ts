export interface BrowserTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
  favIconUrl?: string;
  windowId?: number;
}

export interface WSMessageRequest {
  id: string;
  action: string;
  payload?: any;
}

export interface WSMessageResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface InteractiveElementInfo {
  index: number;
  tagName: string;
  type?: string;
  id?: string;
  name?: string;
  className?: string;
  text?: string;
  placeholder?: string;
  value?: string;
  href?: string;
  selector: string;
  isVisible: boolean;
  disabled?: boolean;
}
