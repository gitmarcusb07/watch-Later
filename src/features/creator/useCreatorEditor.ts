import { useMemo, useReducer } from 'react';
import {
  CREATOR_DATA_VERSION,
  CREATOR_DEFAULT_BRANDING,
  CREATOR_MAX_BRAND_HANDLE,
  CREATOR_MAX_BRAND_NAME,
  CREATOR_MAX_BRAND_TAGLINE,
  CREATOR_MAX_CLOSING,
  CREATOR_MAX_DESCRIPTION,
  CREATOR_MAX_HEADLINE,
  CREATOR_MAX_NAME,
  CREATOR_MAX_SUBTITLE,
  type CreatorAccentId,
  type CreatorFormat,
  type CreatorProjectData,
  type CreatorSlide,
  type CreatorTemplateId,
  type CreatorTheme,
  type CreatorTitleRef,
} from '@/domain/models/creator';
import { creatorTemplate } from './templates';
import { addTitleRefsToSlides, createSlideForTemplate } from './titleRefs';
import { clampCreatorText, formatMaxSlides } from './validation';

/**
 * Editor state for one creator project. The reducer is pure and typed so every
 * mutation (texts, metadata toggles, titles, slides) is unit-testable without
 * a renderer; the hook only memoizes dispatch wrappers.
 */

export interface CreatorEditorState {
  /** Set once the draft has been saved on this device. */
  projectId?: string;
  name: string;
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  caption: string;
  data: CreatorProjectData;
  /** False right after load/save; any edit flips it back to true. */
  dirty: boolean;
}

export type CreatorSlideFlag = 'showRating' | 'showReleaseDate' | 'showGenres' | 'showProviders';
export type CreatorSlideTextKey = 'headline' | 'subtitle' | 'description' | 'closing';
export type CreatorBrandingKey = 'name' | 'handle' | 'tagline';

export type CreatorEditorAction =
  | { type: 'rename'; name: string }
  | { type: 'setCaption'; caption: string }
  | { type: 'setTheme'; theme: CreatorTheme }
  | { type: 'setAccent'; accentId: CreatorAccentId }
  | { type: 'setBranding'; showBranding: boolean }
  | { type: 'setBrandingField'; key: CreatorBrandingKey; value: string }
  | { type: 'setSlideText'; slideId: string; key: CreatorSlideTextKey; value: string }
  | { type: 'setSlideLayout'; slideId: string; layout: CreatorTemplateId }
  | { type: 'toggleSlideFlag'; slideId: string; flag: CreatorSlideFlag }
  | { type: 'addTitles'; slideId: string; refs: CreatorTitleRef[] }
  | { type: 'removeTitle'; slideId: string; index: number }
  | { type: 'moveTitle'; slideId: string; index: number; direction: -1 | 1 }
  | { type: 'addSlide' }
  | { type: 'duplicateSlide'; slideId: string }
  | { type: 'removeSlide'; slideId: string }
  | { type: 'moveSlide'; slideId: string; direction: -1 | 1 }
  | { type: 'markSaved'; projectId: string; name: string };

const TEXT_LIMITS: Record<CreatorSlideTextKey, number> = {
  headline: CREATOR_MAX_HEADLINE,
  subtitle: CREATOR_MAX_SUBTITLE,
  description: CREATOR_MAX_DESCRIPTION,
  closing: CREATOR_MAX_CLOSING,
};

const BRANDING_LIMITS: Record<CreatorBrandingKey, number> = {
  name: CREATOR_MAX_BRAND_NAME,
  handle: CREATOR_MAX_BRAND_HANDLE,
  tagline: CREATOR_MAX_BRAND_TAGLINE,
};

function mapSlide(state: CreatorEditorState, slideId: string, transform: (slide: CreatorSlide) => CreatorSlide): CreatorEditorState {
  const slides = state.data.slides.map((slide) => (slide.id === slideId ? transform(slide) : slide));
  return { ...state, data: { ...state.data, slides }, dirty: true };
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function creatorEditorReducer(state: CreatorEditorState, action: CreatorEditorAction): CreatorEditorState {
  switch (action.type) {
    case 'rename':
      return { ...state, name: clampCreatorText(action.name, CREATOR_MAX_NAME), dirty: true };
    case 'setCaption':
      return { ...state, caption: action.caption, dirty: true };
    case 'setTheme':
      return { ...state, data: { ...state.data, theme: action.theme }, dirty: true };
    case 'setAccent':
      return { ...state, data: { ...state.data, accentId: action.accentId }, dirty: true };
    case 'setBranding':
      return { ...state, data: { ...state.data, showBranding: action.showBranding }, dirty: true };
    case 'setBrandingField':
      return {
        ...state,
        data: {
          ...state.data,
          branding: { ...state.data.branding, [action.key]: clampCreatorText(action.value, BRANDING_LIMITS[action.key]) },
        },
        dirty: true,
      };
    case 'setSlideText':
      return mapSlide(state, action.slideId, (slide) => ({ ...slide, [action.key]: clampCreatorText(action.value, TEXT_LIMITS[action.key]) }));
    case 'setSlideLayout':
      return mapSlide(state, action.slideId, (slide) => ({
        ...slide,
        layout: action.layout,
        // A layout with a smaller cap keeps the first refs and drops the rest.
        titleRefs: slide.titleRefs.slice(0, creatorTemplate(action.layout).maxTitles),
      }));
    case 'toggleSlideFlag':
      return mapSlide(state, action.slideId, (slide) => ({ ...slide, [action.flag]: !slide[action.flag] }));
    case 'addTitles': {
      if (!action.refs.length) return state;
      const targetIndex = Math.max(0, state.data.slides.findIndex((slide) => slide.id === action.slideId));
      const result = addTitleRefsToSlides(state.data.slides, state.templateId, state.format, action.refs, targetIndex);
      return { ...state, data: { ...state.data, slides: result.slides }, dirty: true };
    }
    case 'removeTitle':
      return mapSlide(state, action.slideId, (slide) => ({
        ...slide,
        titleRefs: slide.titleRefs.filter((_, index) => index !== action.index),
      }));
    case 'moveTitle':
      return mapSlide(state, action.slideId, (slide) => ({
        ...slide,
        titleRefs: moveItem(slide.titleRefs, action.index, action.direction),
      }));
    case 'addSlide': {
      if (state.data.slides.length >= formatMaxSlides(state.format)) return state;
      return { ...state, data: { ...state.data, slides: [...state.data.slides, createSlideForTemplate(state.templateId)] }, dirty: true };
    }
    case 'duplicateSlide': {
      if (state.data.slides.length >= formatMaxSlides(state.format)) return state;
      const index = state.data.slides.findIndex((slide) => slide.id === action.slideId);
      if (index < 0) return state;
      const source = state.data.slides[index];
      const copy = createSlideForTemplate(state.templateId);
      const slides = [...state.data.slides];
      slides.splice(index + 1, 0, { ...source, id: copy.id, titleRefs: source.titleRefs.map((ref) => ({ ...ref })) });
      return { ...state, data: { ...state.data, slides }, dirty: true };
    }
    case 'removeSlide': {
      if (state.data.slides.length <= 1) return state;
      return { ...state, data: { ...state.data, slides: state.data.slides.filter((slide) => slide.id !== action.slideId) }, dirty: true };
    }
    case 'moveSlide': {
      const index = state.data.slides.findIndex((slide) => slide.id === action.slideId);
      const slides = moveItem(state.data.slides, index, action.direction);
      if (slides === state.data.slides) return state;
      return { ...state, data: { ...state.data, slides }, dirty: true };
    }
    case 'markSaved':
      return { ...state, projectId: action.projectId, name: action.name, dirty: false };
  }
}

export interface CreatorEditorInitial {
  projectId?: string;
  name: string;
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  caption?: string;
  data?: CreatorProjectData;
  slides?: CreatorSlide[];
}

export function createEditorState(initial: CreatorEditorInitial): CreatorEditorState {
  const data: CreatorProjectData = initial.data ?? {
    version: CREATOR_DATA_VERSION,
    theme: 'dark',
    accentId: 'lavender',
    showBranding: true,
    branding: { ...CREATOR_DEFAULT_BRANDING },
    slides: initial.slides?.length ? initial.slides : [createSlideForTemplate(initial.templateId)],
  };
  return {
    projectId: initial.projectId,
    name: initial.name,
    templateId: initial.templateId,
    format: initial.format,
    caption: initial.caption ?? '',
    data: {
      ...data,
      branding: data.branding ?? { ...CREATOR_DEFAULT_BRANDING },
      slides: data.slides.slice(0, formatMaxSlides(initial.format)),
    },
    dirty: false,
  };
}

/** Default draft name for a new project, e.g. "My top 5 · 18 Oct". */
export function defaultProjectName(templateId: CreatorTemplateId, now: Date = new Date()): string {
  const date = `${now.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()]}`;
  const name = creatorTemplate(templateId).name;
  return `${name} · ${date}`;
}

export interface CreatorEditorActions {
  rename: (name: string) => void;
  setCaption: (caption: string) => void;
  setTheme: (theme: CreatorTheme) => void;
  setAccent: (accentId: CreatorAccentId) => void;
  setBranding: (showBranding: boolean) => void;
  setBrandingField: (key: CreatorBrandingKey, value: string) => void;
  setSlideText: (slideId: string, key: CreatorSlideTextKey, value: string) => void;
  setSlideLayout: (slideId: string, layout: CreatorTemplateId) => void;
  toggleSlideFlag: (slideId: string, flag: CreatorSlideFlag) => void;
  addTitles: (slideId: string, refs: CreatorTitleRef[]) => void;
  removeTitle: (slideId: string, index: number) => void;
  moveTitle: (slideId: string, index: number, direction: -1 | 1) => void;
  addSlide: () => void;
  duplicateSlide: (slideId: string) => void;
  removeSlide: (slideId: string) => void;
  moveSlide: (slideId: string, direction: -1 | 1) => void;
  markSaved: (projectId: string, name: string) => void;
}

export function useCreatorEditor(initial: CreatorEditorState) {
  const [state, dispatch] = useReducer(creatorEditorReducer, initial);
  const actions = useMemo<CreatorEditorActions>(() => ({
    rename: (name: string) => dispatch({ type: 'rename', name }),
    setCaption: (caption: string) => dispatch({ type: 'setCaption', caption }),
    setTheme: (theme: CreatorTheme) => dispatch({ type: 'setTheme', theme }),
    setAccent: (accentId: CreatorAccentId) => dispatch({ type: 'setAccent', accentId }),
    setBranding: (showBranding: boolean) => dispatch({ type: 'setBranding', showBranding }),
    setBrandingField: (key: CreatorBrandingKey, value: string) => dispatch({ type: 'setBrandingField', key, value }),
    setSlideText: (slideId: string, key: CreatorSlideTextKey, value: string) => dispatch({ type: 'setSlideText', slideId, key, value }),
    setSlideLayout: (slideId: string, layout: CreatorTemplateId) => dispatch({ type: 'setSlideLayout', slideId, layout }),
    toggleSlideFlag: (slideId: string, flag: CreatorSlideFlag) => dispatch({ type: 'toggleSlideFlag', slideId, flag }),
    addTitles: (slideId: string, refs: CreatorTitleRef[]) => dispatch({ type: 'addTitles', slideId, refs }),
    removeTitle: (slideId: string, index: number) => dispatch({ type: 'removeTitle', slideId, index }),
    moveTitle: (slideId: string, index: number, direction: -1 | 1) => dispatch({ type: 'moveTitle', slideId, index, direction }),
    addSlide: () => dispatch({ type: 'addSlide' }),
    duplicateSlide: (slideId: string) => dispatch({ type: 'duplicateSlide', slideId }),
    removeSlide: (slideId: string) => dispatch({ type: 'removeSlide', slideId }),
    moveSlide: (slideId: string, direction: -1 | 1) => dispatch({ type: 'moveSlide', slideId, direction }),
    markSaved: (projectId: string, name: string) => dispatch({ type: 'markSaved', projectId, name }),
  }), []);
  return { state, actions, canAddSlide: state.data.slides.length < formatMaxSlides(state.format) };
}

/** Screen-side helper: how many of `refs` would land on this project. */
export function previewAddTitles(state: CreatorEditorState, slideId: string, refs: CreatorTitleRef[]): { added: number; dropped: number } {
  const targetIndex = Math.max(0, state.data.slides.findIndex((slide) => slide.id === slideId));
  const result = addTitleRefsToSlides(state.data.slides, state.templateId, state.format, refs, targetIndex);
  return { added: result.added, dropped: result.dropped };
}
