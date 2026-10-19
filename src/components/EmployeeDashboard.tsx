import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AppUser,
  ScreenshotLog,
  StorageSettings,
} from '../types';

import {
  Play,
  Pause,
  Square,
  Camera,
  Calendar,
  Clock,
  Monitor,
  RefreshCw,
  AlertCircle,
  X,
  CheckCircle2,
} from 'lucide-react';

import {
  canvasToBlob,
  formatSecondsToHoursMinutes,
  formatTimeString,
  generateThumbnailDataUrl,
  getHourSlotKey,
  getTodayDateKey,
} from '../lib/utils';

import {
  getLocalScreenshots,
  startScreenshotUploadScheduler,
  uploadScreenshotLocally,
} from '../lib/localStorageService';

import {
  setCachedScreenshot,
} from '../lib/screenshotCache';

import {
  ScreenshotViewerImage,
} from './ScreenshotViewerImage';

// ======================================================
// BACKEND
// ======================================================

const getBackendUrl = (): string => {
  const configured =
    import.meta.env.VITE_BACKEND_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  return 'https://codesdot-workmonitor.work-nest.workers.dev';
};

// ====================================================
// SCREENSHOT CLOUD UPLOAD WINDOW
// ====================================================

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const TRACKING_START_MINUTES = 8 * 60 + 30;
const TRACKING_END_MINUTES = 20 * 60 + 30;

const getIndiaMinutes = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
};

const isScreenshotUploadWindowOpen = (date = new Date()) => {
  const minutes = getIndiaMinutes(date);
  return minutes >= TRACKING_START_MINUTES && minutes <= TRACKING_END_MINUTES;
};

// ======================================================
// SAFE JSON
// ======================================================

const readApiJson = async (
  response: Response
