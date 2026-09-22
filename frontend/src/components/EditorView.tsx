import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NoteItem, ContentBlock, TaskItem, TableCell, TopicItem, MediaImageItem, ChannelItem } from '../types';
import { t } from '../services/i18n';
import { exportNoteToTelegram, uploadMediaToBackend } from '../services/api';
import { compressImage, deleteFromImgbb } from '../services/imgbb';

interface EditorViewProps {
  note: NoteItem;
  topics: TopicItem[];
  channels?: ChannelItem[];
  onBack: () => void;
  onSave: (updated: NoteItem) => void;
  onDelete: (id: string) => void;
}

const setCaretToStart = (el: HTMLElement) => {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
};

const setCaretAtTextOffset = (root: Node, targetOffset: number) => {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let currentLength = 0;
  let node = walker.nextNode();
  while (node) {
    const nextLength = currentLength + (node.nodeValue?.length || 0);
    if (targetOffset <= nextLength) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, targetOffset - currentLength));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    currentLength = nextLength;
    node = walker.nextNode();
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
};

const stripEdgeBreaks = (html: string): string => {
  let result = (html || '').trim();
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result
      .replace(/^(?:&nbsp;|\s|<br\s*[\/]?>|<div>(?:\s|<br\s*[\/]?>|&nbsp;)*<\/div>|\u200B)+/gi, '')
      .replace(/(?:&nbsp;|\s|<br\s*[\/]?>|<div>(?:\s|<br\s*[\/]?>|&nbsp;)*<\/div>|\u200B)+$/gi, '')
      .trim();
  }
  return result;
};

const EditableBlock: React.FC<{
  html: string;
  placeholder: string;
  className?: string;
  onFocus?: () => void;
  onChange: (newHtml: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onAnchorClick?: (href: string) => void;
}> = ({ html, placeholder, className, onFocus, onChange, onKeyDown, onAnchorClick }) => {
  const divRef = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!divRef.current) return;
    if (lastHtmlRef.current === null || html !== lastHtmlRef.current) {
      divRef.current.innerHTML = html || '';
      lastHtmlRef.current = html;
    }
  }, [html]);

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (anchor && onAnchorClick) {
      const href = anchor.getAttribute('href') || '';
      if (href) {
        onAnchorClick(href);
      }
    }
  };

  return (
    <div
      ref={divRef}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onFocus={onFocus}
      onClick={handleClick}
      onInput={(e) => {
        const currentHtml = e.currentTarget.innerHTML;
        lastHtmlRef.current = currentHtml;
        onChange(currentHtml);
      }}
      onBlur={(e) => {
        const currentHtml = e.currentTarget.innerHTML;
        lastHtmlRef.current = currentHtml;
        onChange(currentHtml);
      }}
      onKeyDown={onKeyDown}
      onPaste={handlePaste}
      className={className}
    />
  );
};

export const EditorView: React.FC<EditorViewProps> = ({
  note,
  topics,
  channels = [],
  onBack,
  onSave,
  onDelete,
}) => {
  const normalizeBlocks = (rawBlocks: ContentBlock[]): ContentBlock[] => {
    if (!rawBlocks || rawBlocks.length === 0) {
      return [{ id: `p-${Date.now()}`, type: 'paragraph', text: '' }];
    }
    return rawBlocks.map((b: any, idx) => {
      const id = b.id || `block-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
      if (b.type === 'media') {
        const rawImages = Array.isArray(b.images) ? b.images : [];
        const normalizedImages: MediaImageItem[] = rawImages
          .map((img: any, imgIdx: number) => {
            if (typeof img === 'string') {
              return { id: `img-${Date.now()}-${imgIdx}`, url: img };
            }
            return {
              id: img?.id || `img-${Date.now()}-${imgIdx}`,
              url: img?.url || '',
              delete_url: img?.delete_url,
            };
          })
          .filter((img: MediaImageItem) => Boolean(img.url));
        return {
          id,
          type: 'media',
          layout: b.layout || (normalizedImages.length > 1 ? 'collage' : 'single'),
          images: normalizedImages,
          caption: b.caption || '',
        };
      }
      if (b.type === 'blockquote') {
        const text = b.blocks && b.blocks[0] && b.blocks[0].text ? b.blocks[0].text : (b.text || '');
        return { id, type: 'quote', text, credit: b.credit || '' };
      }
      if (b.type === 'pre') {
        return { id, type: 'code', text: b.text || '', language: b.language || 'javascript' };
      }
      if (b.type === 'button_row') {
        return {
          id,
          type: 'button_row',
          align: b.align || 'center',
          full_width: b.full_width !== undefined ? Boolean(b.full_width) : false,
          buttons: Array.isArray(b.buttons)
            ? b.buttons.map((btn: any, bIdx: number) => ({
                id: btn.id || `btn-${Date.now()}-${bIdx}`,
                text: btn.text || 'Button',
                style: btn.style || 'default',
                type: btn.type || 'url',
                value: btn.value || btn.url || btn.copy_text || '',
              }))
            : [],
        };
      }
      if (b.type === 'list') {
        const hasTaskStyle = b.style === 'task' || (!b.style && b.items?.some((i: any) => i.has_checkbox || i.is_checked !== undefined));
        const resolvedStyle = hasTaskStyle ? 'task' : (b.style || 'bullet');
        return {
          ...b,
          id,
          style: resolvedStyle,
          items: (b.items || []).map((it: any) => ({
            id: it.id || `task-${Date.now()}-${Math.random()}`,
            text: it.text || '',
            is_checked: Boolean(it.is_checked),
          })),
        };
      }
      return { ...b, id };
    });
  };

  const initialBlocks = normalizeBlocks(note.blocks);
  const [currentNote, setCurrentNote] = useState<NoteItem>({ ...note, blocks: initialBlocks });
  const [history, setHistory] = useState<NoteItem[]>([{ ...note, blocks: initialBlocks }]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number | null>(null);
  const [activeTableCell, setActiveTableCell] = useState<{ blockIndex: number; rowIndex: number; colIndex: number } | null>(null);
  const [activeToolbarTab, setActiveToolbarTab] = useState<'text' | 'lists' | 'quotes' | 'media' | 'table' | 'objects'>('text');
  const [activeSlideIndices, setActiveSlideIndices] = useState<Record<string, number>>({});
  const [openDetailsMap, setOpenDetailsMap] = useState<Record<string, boolean>>({});
  const [isUploadingGlobal, setIsUploadingGlobal] = useState<boolean>(false);
  const [editingButtonModal, setEditingButtonModal] = useState<{
    blockIndex: number;
    buttonIndex: number;
    id: string;
    text: string;
    style: 'default' | 'primary' | 'success' | 'danger';
    type: 'url' | 'copy_text';
    value: string;
  } | null>(null);

  const [timePickerModal, setTimePickerModal] = useState<{
    isOpen: boolean;
    datetimeVal: string;
    format: 'wDT' | 'full' | 'time' | 'rel';
  }>({
    isOpen: false,
    datetimeVal: '',
    format: 'wDT',
  });

  const savedRangeRef = useRef<Range | null>(null);

  const forceDismissKeyboard = () => {
    setIsEditorActive(false);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges(); // Menghapus sorotan teks agar tombol "Salin" hilang
    
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    // Trik khusus memaksa keyboard HP menutup
    const tempInput = document.createElement('input');
    tempInput.setAttribute('readonly', 'readonly');
    tempInput.setAttribute('style', 'position:fixed; top:-9999px; left:-9999px; opacity:0;');
    document.body.appendChild(tempInput);
    tempInput.focus();
    setTimeout(() => {
      tempInput.blur();
      if (document.body.contains(tempInput)) document.body.removeChild(tempInput);
    }, 15);
  };

  const openTimePicker = () => {
    triggerHaptic('light');
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
    
    forceDismissKeyboard(); // Panggil fungsi pemaksa tutup di sini
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    setTimePickerModal({
      isOpen: true,
      datetimeVal: `${year}-${month}-${day}T${hours}:${minutes}`,
      format: 'wDT',
    });
  };

  const insertDynamicTime = () => {
    if (!timePickerModal.datetimeVal) return;
    triggerHaptic('medium');
    const dateObj = new Date(timePickerModal.datetimeVal);
    const unixTimestamp = Math.floor(dateObj.getTime() / 1000);
    const formatCode = timePickerModal.format === 'full' ? '' : timePickerModal.format;
    const formatAttr = formatCode ? ` format="${formatCode}"` : '';
    const localizedDisplay = dateObj.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const timeTagHtml = `<tg-time unix="${unixTimestamp}"${formatAttr}>${localizedDisplay}</tg-time>&nbsp;`;

    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
      document.execCommand('insertHTML', false, timeTagHtml);
      if (focusedBlockIndex !== null && currentNote.blocks[focusedBlockIndex]) {
        const currentEl = blockElementRefs.current[currentNote.blocks[focusedBlockIndex].id];
        const editableDiv = currentEl?.querySelector('[contenteditable]');
        if (editableDiv) {
          updateBlock(
            focusedBlockIndex,
            { ...currentNote.blocks[focusedBlockIndex], text: editableDiv.innerHTML } as ContentBlock,
            true
          );
        }
      }
    } else {
      const targetPos = focusedBlockIndex !== null && focusedBlockIndex >= 0 && focusedBlockIndex < currentNote.blocks.length
        ? focusedBlockIndex + 1
        : currentNote.blocks.length;
      const newBlock: ContentBlock = {
        id: `p-${Date.now()}`,
        type: 'paragraph',
        text: timeTagHtml,
      };
      const nextBlocks = [
        ...currentNote.blocks.slice(0, targetPos),
        newBlock,
        ...currentNote.blocks.slice(targetPos),
      ];
      persistChange({ ...currentNote, blocks: nextBlocks }, true);
      setFocusedBlockIndex(targetPos);
    }
    setTimePickerModal((prev) => ({ ...prev, isOpen: false }));
    savedRangeRef.current = null;
  };

  const toggleDetails = (blockId: string) => {
    triggerHaptic('light');
    setOpenDetailsMap((prev) => ({
      ...prev,
      [blockId]: prev[blockId] === false ? true : false,
    }));
  };
const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
const [uploadingMediaType, setUploadingMediaType] = useState<'image' | 'audio' | 'file' | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
const audioInputRef = useRef<HTMLInputElement>(null);
const docFileInputRef = useRef<HTMLInputElement>(null);
const targetMediaBlockIndexRef = useRef<number | null>(null);
const totalImageCount = currentNote.blocks.reduce((count, b) => {
  return b.type === 'media' ? count + (b.images?.length || 0) : count;
}, 0);
const totalAudioCount = currentNote.blocks.filter((b) => b.type === 'audio').length;
const totalFileCount = currentNote.blocks.filter((b) => b.type === 'file').length;

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const triggerUploadAudio = () => {
  if (totalAudioCount >= 1) {
    triggerHaptic('medium');
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
    alert(t('audio_limit_reached'));
    return;
  }
  triggerHaptic('light');
  audioInputRef.current?.click();
};

const triggerUploadDoc = () => {
  if (totalFileCount >= 1) {
    triggerHaptic('medium');
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
    alert(t('file_limit_reached'));
    return;
  }
  triggerHaptic('light');
  docFileInputRef.current?.click();
};

const handleAudioFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 10 * 1024 * 1024) {
      triggerHaptic('heavy');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      alert(t('file_size_exceeded'));
      return;
    }
    setIsUploadingGlobal(true);
    setUploadingMediaType('audio');
    try {
      const result = await uploadMediaToBackend(file);
      const newBlock: ContentBlock = {
      id: `b-audio-${Date.now()}`,
      type: 'audio',
      url: result.url,
      name: file.name,
      size: file.size,
      caption: '',
    };
    const trailingParagraph: ContentBlock = {
      id: `p-${Date.now()}`,
      type: 'paragraph',
      text: '',
    };
    const targetPos = focusedBlockIndex !== null && focusedBlockIndex >= 0 && focusedBlockIndex < currentNote.blocks.length
      ? focusedBlockIndex + 1
      : currentNote.blocks.length;
    captureFlipPositions();
      const nextBlocks = [
        ...currentNote.blocks.slice(0, targetPos),
        newBlock,
        trailingParagraph,
        ...currentNote.blocks.slice(targetPos),
      ];
      persistChange({ ...currentNote, blocks: nextBlocks }, true);
      setFocusedBlockIndex(targetPos);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
    console.error(`AUDIO_UPLOAD_FAILED: ${(err as Error).message}`);
    triggerHaptic('heavy');
    setExportNotice(t('export_failed'));
    setTimeout(() => setExportNotice(null), 3000);
  } finally {
    setIsUploadingGlobal(false);
    setUploadingMediaType(null);
  }
};

const handleDocFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 10 * 1024 * 1024) {
      triggerHaptic('heavy');
      alert(t('file_size_exceeded'));
      return;
    }
    setIsUploadingGlobal(true);
    setUploadingMediaType('file');
    try {
      const result = await uploadMediaToBackend(file);
      const newBlock: ContentBlock = {
      id: `b-doc-${Date.now()}`,
      type: 'file',
      url: result.url,
      name: file.name,
      size: file.size,
      caption: '',
    };
    const trailingParagraph: ContentBlock = {
      id: `p-${Date.now()}`,
      type: 'paragraph',
      text: '',
    };
    const targetPos = focusedBlockIndex !== null && focusedBlockIndex >= 0 && focusedBlockIndex < currentNote.blocks.length
      ? focusedBlockIndex + 1
      : currentNote.blocks.length;
    const nextBlocks = [
      ...currentNote.blocks.slice(0, targetPos),
      newBlock,
      trailingParagraph,
      ...currentNote.blocks.slice(targetPos),
    ];
    persistChange({ ...currentNote, blocks: nextBlocks }, true);
    setFocusedBlockIndex(targetPos);
    triggerHaptic('medium');
  } catch (err) {
    console.error(`DOC_UPLOAD_FAILED: ${(err as Error).message}`);
    triggerHaptic('heavy');
    setExportNotice(t('export_failed'));
    setTimeout(() => setExportNotice(null), 3000);
  } finally {
    setIsUploadingGlobal(false);
    setUploadingMediaType(null);
  }
};
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [showToc, setShowToc] = useState<boolean>(false);
  const [keyboardInset, setKeyboardInset] = useState<number>(0);
  const [isEditorActive, setIsEditorActive] = useState<boolean>(false);
  const [activeFormats, setActiveFormats] = useState<{
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    code: boolean;
    spoiler: boolean;
    mark: boolean;
    link: boolean;
  }>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
    spoiler: false,
    mark: false,
    link: false,
  });

  const [linkModal, setLinkModal] = useState<{
    isOpen: boolean;
    url: string;
    text: string;
    isEditing: boolean;
  }>({
    isOpen: false,
    url: '',
    text: '',
    isEditing: false,
  });
  const [botPromptModal, setBotPromptModal] = useState<{ isOpen: boolean; botUsername: string }>({
    isOpen: false,
    botUsername: '',
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const blockElementRefs = useRef<Record<string, HTMLElement | null>>({});
  const historyTimerRef = useRef<number | null>(null);
  const flipPositionsRef = useRef<Map<string, number>>(new Map());
  const lastEnterRef = useRef<{ index: number; time: number } | null>(null);
  const pendingDeletionsRef = useRef<Set<string>>(new Set());

  const captureFlipPositions = useCallback(() => {
    const container = scrollContainerRef.current;
    const scrollOffset = container ? container.scrollTop : 0;
    const positions = new Map<string, number>();
    currentNote.blocks.forEach((b) => {
      const el = blockElementRefs.current[b.id];
      if (el) {
        positions.set(b.id, el.getBoundingClientRect().top + scrollOffset);
      }
    });
    flipPositionsRef.current = positions;
  }, [currentNote.blocks]);

  useLayoutEffect(() => {
    if (flipPositionsRef.current.size === 0) return;
    const prevPositions = flipPositionsRef.current;
    flipPositionsRef.current = new Map();

    const container = scrollContainerRef.current;
    const scrollOffset = container ? container.scrollTop : 0;

    currentNote.blocks.forEach((b) => {
      const oldTop = prevPositions.get(b.id);
      const el = blockElementRefs.current[b.id];
      if (oldTop !== undefined && el) {
        const newTop = el.getBoundingClientRect().top + scrollOffset;
        const delta = oldTop - newTop;
        if (Math.abs(delta) > 0.5) {
          el.animate(
            [
              { transform: `translate3d(0, ${delta}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: 260,
              easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)',
            }
          );
        }
      }
    });
  }, [currentNote.blocks]);

  const triggerHaptic = (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light') => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  };

  useLayoutEffect(() => {
    if (flipPositionsRef.current.size === 0) return;
    const prevPositions = flipPositionsRef.current;
    flipPositionsRef.current = new Map();

    currentNote.blocks.forEach((b) => {
      const oldTop = prevPositions.get(b.id);
      const el = blockElementRefs.current[b.id];
      if (oldTop !== undefined && el) {
        const newTop = el.getBoundingClientRect().top;
        const delta = oldTop - newTop;
        if (Math.abs(delta) > 0.5) {
          el.animate(
            [
              { transform: `translate3d(0, ${delta}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: 260,
              easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)',
            }
          );
        }
      }
    });
  }, [currentNote.blocks]);


  const isMovingRef = useRef<boolean>(false);

  const triggerUploadNewImage = () => {
  if (totalImageCount >= 2) {
    triggerHaptic('medium');
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
    return;
  }
  triggerHaptic('light');
  targetMediaBlockIndexRef.current = null;
  fileInputRef.current?.click();
};

const triggerAddSecondImage = (blockIndex: number) => {
  if (totalImageCount >= 2) {
    triggerHaptic('medium');
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
    return;
  }
  triggerHaptic('light');
  targetMediaBlockIndexRef.current = blockIndex;
  fileInputRef.current?.click();
};

const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    
    // Tambahan pembatasan ukuran maksimal 10MB untuk gambar agar aman
    if (file.size > 10 * 1024 * 1024) {
      triggerHaptic('heavy');
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      alert(t('file_size_exceeded'));
      return;
    }

    const targetIdx = targetMediaBlockIndexRef.current;
    const tempImgId = `img-${Date.now()}`;
    
    setIsUploadingGlobal(true);
    setUploadingMediaType('image'); // INI YANG MEMBUAT ANIMASI LOADING MUNCUL
    
    if (targetIdx !== null && currentNote.blocks[targetIdx]?.type === 'media') {
      setUploadingBlockId(currentNote.blocks[targetIdx].id);
    }
    
    try {
      const compressedFile = await compressImage(file, 0.75, 1440); // KOMPRESI KEMBALI AKTIF
      const result = await uploadMediaToBackend(compressedFile);
      const newImgItem: MediaImageItem = {
        id: tempImgId,
        url: result.url,
      };
      
      if (targetIdx !== null && currentNote.blocks[targetIdx]?.type === 'media') {
        const existingBlock = currentNote.blocks[targetIdx] as Extract<ContentBlock, { type: 'media' }>;
        const nextImages = [...existingBlock.images, newImgItem].slice(0, 2);
        const nextBlock: ContentBlock = {
          ...existingBlock,
          layout: 'collage',
          images: nextImages,
        };
        updateBlock(targetIdx, nextBlock, true);
      } else {
        const newBlockId = `b-media-${Date.now()}`;
        const newBlock: ContentBlock = {
          id: newBlockId,
          type: 'media',
          layout: 'single',
          caption: '',
          images: [newImgItem],
        };
        const trailingParagraph: ContentBlock = {
          id: `p-${Date.now()}`,
          type: 'paragraph',
          text: '',
        };
        const targetPos = focusedBlockIndex !== null && focusedBlockIndex >= 0 && focusedBlockIndex < currentNote.blocks.length
          ? focusedBlockIndex + 1
          : currentNote.blocks.length;
        const nextBlocks = [
          ...currentNote.blocks.slice(0, targetPos),
          newBlock,
          trailingParagraph,
          ...currentNote.blocks.slice(targetPos),
        ];
        persistChange({ ...currentNote, blocks: nextBlocks }, true);
        setFocusedBlockIndex(targetPos);
      }
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (err) {
      console.error(`IMAGE_UPLOAD_FAILED: ${(err as Error).message}`);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setIsUploadingGlobal(false);
      setUploadingMediaType(null); // MATIKAN ANIMASI LOADING SETELAH SELESAI
      setUploadingBlockId(null);
      targetMediaBlockIndexRef.current = null;
    }
  };

const toggleMediaLayout = (blockIndex: number, newLayout: 'collage' | 'slideshow') => {
  triggerHaptic('light');
  const block = currentNote.blocks[blockIndex];
  if (block.type !== 'media') return;
  updateBlock(blockIndex, { ...block, layout: newLayout }, true);
};

const handleSlideNav = (blockId: string, direction: 'prev' | 'next', total: number) => {
  triggerHaptic('light');
  setActiveSlideIndices((prev) => {
    const current = prev[blockId] || 0;
    const nextIndex = direction === 'next' ? (current + 1) % total : (current - 1 + total) % total;
    return { ...prev, [blockId]: nextIndex };
  });
};

  const updateActiveFormats = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setActiveFormats({
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        code: false,
        spoiler: false,
        mark: false,
        link: false,
      });
      return;
    }
    let parentNode: Node | null = sel.anchorNode;
    if (parentNode && parentNode.nodeType === Node.TEXT_NODE) {
      parentNode = parentNode.parentNode;
    }
    const parentEl = parentNode as HTMLElement | null;
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strike: document.queryCommandState('strikeThrough'),
      code: Boolean(parentEl?.closest('code')),
      spoiler: Boolean(parentEl?.closest('tg-spoiler')),
      mark: Boolean(parentEl?.closest('mark')),
      link: Boolean(parentEl?.closest('a')),
    });
  }, []);

  const openLinkModal = () => {
    triggerHaptic('light');
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    savedRangeRef.current = range.cloneRange();
    let parentNode: Node | null = range.commonAncestorContainer;
    if (parentNode.nodeType === Node.TEXT_NODE) {
      parentNode = parentNode.parentNode;
    }
    const existingAnchor = (parentNode as HTMLElement)?.closest('a');
    const linkText = existingAnchor ? (existingAnchor.textContent || '') : range.toString().trim();
    const linkHref = existingAnchor ? (existingAnchor.getAttribute('href') || '') : '';
    
    forceDismissKeyboard();
    
    setLinkModal({
      isOpen: true,
      url: linkHref,
      text: linkText,
      isEditing: Boolean(existingAnchor),
    });
  };

  const applyLink = () => {
    if (!linkModal.url.trim()) return;
    triggerHaptic('medium');
    const sel = window.getSelection();
    if (savedRangeRef.current) {
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
    }
    let parentNode: Node | null = savedRangeRef.current?.commonAncestorContainer || null;
    if (parentNode && parentNode.nodeType === Node.TEXT_NODE) {
      parentNode = parentNode.parentNode;
    }
    const existingAnchor = (parentNode as HTMLElement)?.closest('a');
    const cleanUrl = linkModal.url.trim();
    const finalUrl = cleanUrl.startsWith('#') || cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('tg://') || cleanUrl.startsWith('mailto:') || cleanUrl.startsWith('tel:')
      ? cleanUrl
      : `https://${cleanUrl}`;

    if (existingAnchor) {
      existingAnchor.setAttribute('href', finalUrl);
      if (linkModal.text.trim()) {
        existingAnchor.textContent = linkModal.text.trim();
      }
    } else if (savedRangeRef.current && !savedRangeRef.current.collapsed) {
      const a = document.createElement('a');
      a.href = finalUrl;
      const content = savedRangeRef.current.extractContents();
      a.appendChild(content);
      savedRangeRef.current.insertNode(a);
      sel?.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(a);
      sel?.addRange(nextRange);
    } else if (savedRangeRef.current) {
      const a = document.createElement('a');
      a.href = finalUrl;
      a.textContent = linkModal.text.trim() || finalUrl;
      savedRangeRef.current.insertNode(a);
    }

    if (activeEditableRef.current) {
      activeEditableRef.current.dispatchEvent(new Event('input', { bubbles: true }));
      activeEditableRef.current = null;
    }
    setLinkModal((prev) => ({ ...prev, isOpen: false }));
    savedRangeRef.current = null;
    updateActiveFormats();
  };

  const removeLink = () => {
    triggerHaptic('light');
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
      let parentNode: Node | null = savedRangeRef.current.commonAncestorContainer;
      if (parentNode.nodeType === Node.TEXT_NODE) {
        parentNode = parentNode.parentNode;
      }
      const existingAnchor = (parentNode as HTMLElement)?.closest('a');
      if (existingAnchor) {
        const parent = existingAnchor.parentNode;
        while (existingAnchor.firstChild) {
          parent?.insertBefore(existingAnchor.firstChild, existingAnchor);
        }
        parent?.removeChild(existingAnchor);
      }
      if (focusedBlockIndex !== null && currentNote.blocks[focusedBlockIndex]) {
        const currentEl = blockElementRefs.current[currentNote.blocks[focusedBlockIndex].id];
        const editableDiv = currentEl?.querySelector('[contenteditable]');
        if (editableDiv) {
          updateBlock(
            focusedBlockIndex,
            { ...currentNote.blocks[focusedBlockIndex], text: editableDiv.innerHTML } as ContentBlock,
            true
          );
        }
      }
    }
    setLinkModal((prev) => ({ ...prev, isOpen: false }));
    savedRangeRef.current = null;
    updateActiveFormats();
  };

  useEffect(() => {
    const handleViewport = () => {
      if (window.visualViewport) {
        const offset = Math.max(0, window.innerHeight - window.visualViewport.height);
        setKeyboardInset(offset);
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-modal="true"]')) {
        setIsEditorActive(false);
        return;
      }
      if (target?.closest('[contenteditable="true"]') || target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') {
        setIsEditorActive(true);
      }
    };
    const handleFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.closest('[data-format-bar="true"]')) {
        setTimeout(() => {
          const active = document.activeElement as HTMLElement | null;
          if (
            (!active?.closest('[contenteditable="true"]') && active?.tagName !== 'TEXTAREA' && active?.tagName !== 'INPUT') ||
            active?.closest('[data-modal="true"]')
          ) {
            setIsEditorActive(false);
          }
        }, 120);
      }
    };

    window.visualViewport?.addEventListener('resize', handleViewport);
    window.visualViewport?.addEventListener('scroll', handleViewport);
    document.addEventListener('selectionchange', updateActiveFormats);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewport);
      window.visualViewport?.removeEventListener('scroll', handleViewport);
      document.removeEventListener('selectionchange', updateActiveFormats);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [updateActiveFormats]);

  const activeEditableRef = useRef<HTMLElement | null>(null);

  const syncActiveContentEditable = () => {
    const sel = window.getSelection();
    let node: Node | null = sel?.anchorNode || null;
    if (node && node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode;
    }
    const el = (node as HTMLElement)?.closest<HTMLDivElement>('[contenteditable="true"]');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const applyFormatCommand = (command: 'bold' | 'italic' | 'underline' | 'strikeThrough') => {
    triggerHaptic('light');
    document.execCommand(command, false);
    syncActiveContentEditable();
    updateActiveFormats();
  };

  const toggleCustomTag = (tagName: 'tg-spoiler' | 'code' | 'mark') => {
    triggerHaptic('light');
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    let parentNode: Node | null = range.commonAncestorContainer;
    if (parentNode.nodeType === Node.TEXT_NODE) {
      parentNode = parentNode.parentNode;
    }
    const existing = (parentNode as HTMLElement)?.closest(tagName);
    if (existing) {
      const parent = existing.parentNode;
      while (existing.firstChild) {
        parent?.insertBefore(existing.firstChild, existing);
      }
      parent?.removeChild(existing);
    } else {
      const el = document.createElement(tagName);
      try {
        range.surroundContents(el);
      } catch (err) {
        const fragment = range.extractContents();
        el.appendChild(fragment);
        range.insertNode(el);
      }
      sel.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(el);
      sel.addRange(nextRange);
    }
    if (focusedBlockIndex !== null && currentNote.blocks[focusedBlockIndex]) {
      const currentEl = blockElementRefs.current[currentNote.blocks[focusedBlockIndex].id];
      const editableDiv = currentEl?.querySelector('[contenteditable]');
      if (editableDiv) {
        updateBlock(
          focusedBlockIndex,
          { ...currentNote.blocks[focusedBlockIndex], text: editableDiv.innerHTML } as ContentBlock,
          true
        );
      }
    }
    updateActiveFormats();
  };

  const handleClearFormatting = () => {
    triggerHaptic('medium');
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    document.execCommand('removeFormat', false);
    const range = sel.getRangeAt(0);
    let container: Node | null = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentNode;
    }
    const parentEl = container as HTMLElement | null;
    const tagsToRemove = ['TG-SPOILER', 'CODE', 'B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL', 'MARK', 'A'];
    tagsToRemove.forEach((tag) => {
      const el = parentEl?.closest(tag);
      if (el && range.intersectsNode(el)) {
        const parent = el.parentNode;
        while (el.firstChild) {
          parent?.insertBefore(el.firstChild, el);
        }
        parent?.removeChild(el);
      }
    });
    if (parentEl) {
      const descendants = parentEl.querySelectorAll('tg-spoiler, code, b, strong, i, em, u, ins, s, strike, del, mark, a');
      descendants.forEach((el) => {
        if (range.intersectsNode(el)) {
          const parent = el.parentNode;
          while (el.firstChild) {
            parent?.insertBefore(el.firstChild, el);
          }
          parent?.removeChild(el);
        }
      });
    }
    if (focusedBlockIndex !== null && currentNote.blocks[focusedBlockIndex]) {
      const currentEl = blockElementRefs.current[currentNote.blocks[focusedBlockIndex].id];
      const editableDiv = currentEl?.querySelector('[contenteditable]');
      if (editableDiv) {
        updateBlock(
          focusedBlockIndex,
          { ...currentNote.blocks[focusedBlockIndex], text: editableDiv.innerHTML } as ContentBlock,
          true
        );
      }
    }
    updateActiveFormats();
  };

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const handleSafeBack = useCallback(() => {
    pendingDeletionsRef.current.forEach((url) => {
      deleteFromImgbb(url);
    });
    pendingDeletionsRef.current.clear();
    onBackRef.current();
  }, []);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.BackButton) {
      tg.BackButton.show();
      const handleNativeBack = () => {
        triggerHaptic();
        handleSafeBack();
      };
      tg.BackButton.onClick(handleNativeBack);
      return () => {
        tg.BackButton.offClick(handleNativeBack);
        tg.BackButton.hide();
      };
    }
  }, [handleSafeBack]);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const persistChange = (updated: NoteItem, immediateHistory: boolean = false) => {
    const safeBlocks = updated.blocks.length === 0
      ? [{ id: `p-${Date.now()}`, type: 'paragraph', text: '' } as ContentBlock]
      : updated.blocks;
    const finalized = { ...updated, blocks: safeBlocks };
    setCurrentNote(finalized);
    onSave(finalized);

    if (immediateHistory) {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        const trimmed = [...next, finalized];
        if (trimmed.length > 40) trimmed.shift();
        return trimmed;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 39));
    } else {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = window.setTimeout(() => {
        setHistory((prev) => {
          const next = prev.slice(0, historyIndex + 1);
          const trimmed = [...next, finalized];
          if (trimmed.length > 40) trimmed.shift();
          return trimmed;
        });
        setHistoryIndex((prev) => Math.min(prev + 1, 39));
      }, 700);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      triggerHaptic('light');
      const targetIndex = historyIndex - 1;
      const target = history[targetIndex];
      setHistoryIndex(targetIndex);
      setCurrentNote(target);
      onSave(target);

      target.blocks.forEach((b) => {
        if (b.type === 'media' && Array.isArray(b.images)) {
          b.images.forEach((img) => {
            if (img.delete_url && pendingDeletionsRef.current.has(img.delete_url)) {
              pendingDeletionsRef.current.delete(img.delete_url);
            }
          });
        }
      });
    }
  };

  const removeBlock = (index: number) => {
    triggerHaptic('medium');
    const block = currentNote.blocks[index];
    if (!block) return;
    if (block.type === 'media' && Array.isArray(block.images)) {
      block.images.forEach((img) => {
        if (img.delete_url) {
          pendingDeletionsRef.current.add(img.delete_url);
        }
      });
    }

    const executeDelete = () => {
      captureFlipPositions();
      const filtered = currentNote.blocks.filter((b) => b.id !== block.id);
      persistChange({ ...currentNote, blocks: filtered }, true);
      setFocusedBlockIndex(null);
    };

    const el = blockElementRefs.current[block.id];
    if (el) {
      const anim = el.animate(
        [
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
          { opacity: 0, transform: 'translate3d(0, -8px, 0) scale(0.985)' },
        ],
        {
          duration: 160,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'forwards',
        }
      );
      anim.onfinish = executeDelete;
    } else {
      executeDelete();
    }
  };

  const removeImageFromBlock = (blockIndex: number, imageIndex: number) => {
    triggerHaptic('light');
    const block = currentNote.blocks[blockIndex];
    if (block.type !== 'media') return;
    const targetImg = block.images[imageIndex];
    if (targetImg?.delete_url) {
      pendingDeletionsRef.current.add(targetImg.delete_url);
    }
    const nextImages = block.images.filter((_, i) => i !== imageIndex);
    if (nextImages.length === 0) {
      removeBlock(blockIndex);
    } else {
      updateBlock(
        blockIndex,
        {
          ...block,
          layout: 'single',
          images: nextImages,
        },
        true
      );
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      triggerHaptic('light');
      const targetIndex = historyIndex + 1;
      const target = history[targetIndex];
      setHistoryIndex(targetIndex);
      setCurrentNote(target);
      onSave(target);
    }
  };

  const handleParagraphSplit = (index: number, leftHtml: string, rightHtml: string) => {
    triggerHaptic('light');
    const currentBlock = currentNote.blocks[index];
    if (!currentBlock || currentBlock.type !== 'paragraph') return;

    captureFlipPositions();
    const newBlockId = `p-${Date.now()}`;
    const updatedCurrent: ContentBlock = {
      id: currentBlock.id,
      type: 'paragraph',
      text: leftHtml,
    };
    const newBlock: ContentBlock = {
      id: newBlockId,
      type: 'paragraph',
      text: rightHtml,
    };

    const nextBlocks = [
      ...currentNote.blocks.slice(0, index),
      updatedCurrent,
      newBlock,
      ...currentNote.blocks.slice(index + 1),
    ];
    persistChange({ ...currentNote, blocks: nextBlocks }, true);
    setFocusedBlockIndex(index + 1);
    setTimeout(() => {
      const el = blockElementRefs.current[newBlockId];
      const editable = el?.querySelector<HTMLDivElement>('[contenteditable="true"]');
      if (editable) {
        setCaretToStart(editable);
      }
    }, 30);
  };

  const handleParagraphMerge = (index: number, currentHtml: string) => {
    if (index <= 0) return;
    const prevBlock = currentNote.blocks[index - 1];
    if (!prevBlock) return;

    if (prevBlock.type === 'paragraph') {
      triggerHaptic('light');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = prevBlock.text;
      const junctionOffset = tempDiv.textContent?.length || 0;

      const cleanCurrent = stripEdgeBreaks(currentHtml);
      const mergedText = prevBlock.text + cleanCurrent;

      const updatedPrev: ContentBlock = {
        id: prevBlock.id,
        type: 'paragraph',
        text: mergedText,
      };

      const nextBlocks = [
        ...currentNote.blocks.slice(0, index - 1),
        updatedPrev,
        ...currentNote.blocks.slice(index + 1),
      ];

      persistChange({ ...currentNote, blocks: nextBlocks }, true);
      setFocusedBlockIndex(index - 1);

      setTimeout(() => {
        const prevEl = blockElementRefs.current[prevBlock.id];
        const prevEditable = prevEl?.querySelector<HTMLDivElement>('[contenteditable="true"]');
        if (prevEditable) {
          prevEditable.focus();
          setCaretAtTextOffset(prevEditable, junctionOffset);
        }
      }, 40);
    } else if (!currentHtml || currentHtml.replace(/<[^>]*>/g, '').trim() === '') {
      triggerHaptic('light');
      const nextBlocks = currentNote.blocks.filter((_, i) => i !== index);
      persistChange({ ...currentNote, blocks: nextBlocks }, true);
      setFocusedBlockIndex(index - 1);

      setTimeout(() => {
        const prevEl = blockElementRefs.current[prevBlock.id];
        const targetFocus = prevEl?.querySelector<HTMLElement>('[contenteditable="true"], input, textarea');
        if (targetFocus) {
          targetFocus.focus();
        }
      }, 40);
    }
  };

  const handleParagraphKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    if (e.key !== 'Enter') {
      lastEnterRef.current = null;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const el = e.currentTarget;

      const preRange = range.cloneRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(range.startContainer, range.startOffset);
      const tempLeft = document.createElement('div');
      tempLeft.appendChild(preRange.cloneContents());

      const postRange = range.cloneRange();
      postRange.selectNodeContents(el);
      postRange.setStart(range.endContainer, range.endOffset);
      const tempRight = document.createElement('div');
      tempRight.appendChild(postRange.cloneContents());

      const leftHtml = tempLeft.innerHTML;
      const rightHtml = tempRight.innerHTML;
      const isConsecutive = lastEnterRef.current?.index === index;
      const leftEndsWithBr = /(?:<br\s*[\/]?>|<div>(?:\s|<br\s*[\/]?>)*<\/div>|\s)+$/i.test(leftHtml);

      if (isConsecutive || leftEndsWithBr) {
        lastEnterRef.current = null;
        const cleanLeft = stripEdgeBreaks(leftHtml);
        const cleanRight = stripEdgeBreaks(rightHtml);
        handleParagraphSplit(index, cleanLeft, cleanRight);
        return;
      }

      lastEnterRef.current = { index, time: Date.now() };
      document.execCommand('insertLineBreak');
      updateBlock(
        index,
        {
          id: currentNote.blocks[index].id,
          type: 'paragraph',
          text: el.innerHTML,
        },
        false
      );
      return;
    }

    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const el = e.currentTarget;

      const cleanText = (el.textContent || '').replace(/[\u200B\uFEFF\s]/g, '');
      const isBlockEmpty = cleanText.length === 0;

      let isAtCaretStart = false;
      if (!isBlockEmpty) {
        try {
          const preRange = document.createRange();
          preRange.selectNodeContents(el);
          preRange.setEnd(range.startContainer, range.startOffset);
          const textBefore = (preRange.toString() || '').replace(/[\u200B\uFEFF\r\n]/g, '');
          isAtCaretStart = textBefore.length === 0;
        } catch {
          isAtCaretStart = range.startOffset === 0;
        }
      }

      if (isBlockEmpty || isAtCaretStart) {
        e.preventDefault();
        handleParagraphMerge(index, isBlockEmpty ? '' : el.innerHTML);
      }
    }
  };

  const handleTitleChange = (title: string) => {
    persistChange({ ...currentNote, title }, false);
  };

  const updateBlock = (index: number, newBlock: ContentBlock, immediateHistory: boolean = false) => {
    const nextBlocks = [...currentNote.blocks];
    nextBlocks[index] = newBlock;
    persistChange({ ...currentNote, blocks: nextBlocks }, immediateHistory);
  };



  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentNote.blocks.length) return;
    triggerHaptic('light');
    captureFlipPositions();

    const nextBlocks = [...currentNote.blocks];
    const temp = nextBlocks[index];
    nextBlocks[index] = nextBlocks[targetIndex];
    nextBlocks[targetIndex] = temp;
    if (activeTableCell && activeTableCell.blockIndex === index) {
      setActiveTableCell({
        ...activeTableCell,
        blockIndex: targetIndex,
      });
    }
    persistChange({ ...currentNote, blocks: nextBlocks }, true);
    setFocusedBlockIndex(targetIndex);
  };

  const appendBlockWithParagraph = (
    type: ContentBlock['type'],
    opts?: { size?: 1 | 2 | 3 | 4 | 5 | 6; style?: 'task' | 'bullet' | 'ordered' }
  ) => {
    if (type === 'media') {
      triggerUploadNewImage();
      return;
    }
    triggerHaptic('medium');
    const bId1 = `b-${Date.now()}-1`;
    const bId2 = `b-${Date.now()}-2`;
    let primaryBlock: ContentBlock;
    switch (type) {
      case 'heading':
        primaryBlock = { id: bId1, type: 'heading', size: opts?.size || 2, text: '' };
        break;
      case 'paragraph':
        primaryBlock = { id: bId1, type: 'paragraph', text: '' };
        break;
      case 'quote':
        primaryBlock = { id: bId1, type: 'quote', text: '', credit: '' };
        break;
      case 'expandable_quote':
        primaryBlock = { id: bId1, type: 'expandable_quote', text: '', credit: '' };
        break;
      case 'pullquote':
        primaryBlock = { id: bId1, type: 'pullquote', text: '', credit: '' };
        break;
      case 'list':
        primaryBlock = {
          id: bId1,
          type: 'list',
          style: opts?.style || 'task',
          items: [{ id: `task-${Date.now()}`, text: '', is_checked: false }],
        };
        break;
      case 'table':
        primaryBlock = {
          id: bId1,
          type: 'table',
          is_bordered: true,
          is_striped: false,
          cells: [
            [
              { text: 'A', is_header: true, align: 'left' },
              { text: 'B', is_header: true, align: 'left' },
            ],
            [
              { text: '', align: 'left' },
              { text: '', align: 'left' },
            ],
          ],
        };
        break;
      case 'code':
        primaryBlock = { id: bId1, type: 'code', text: '', language: 'javascript' };
        break;
      case 'math':
        primaryBlock = { id: bId1, type: 'math', expression: 'E = mc^2' };
        break;
      case 'details':
        primaryBlock = { id: bId1, type: 'details', summary: '', text: '', is_open: false };
        break;
      case 'divider':
        primaryBlock = { id: bId1, type: 'divider' };
        break;
      case 'button_row':
        primaryBlock = {
          id: bId1,
          type: 'button_row',
          align: 'center',
          full_width: false,
          buttons: [
            {
              id: `btn-${Date.now()}`,
              text: t('btn_default_label'),
              style: 'primary',
              type: 'url',
              value: 'https://t.me',
            },
          ],
        };
        break;
      case 'footer':
        primaryBlock = { id: bId1, type: 'footer', text: '' };
        break;
      default:
        primaryBlock = { id: bId1, type: 'paragraph', text: '' };
        break;
    }
    const trailingParagraph: ContentBlock = {
      id: bId2,
      type: 'paragraph',
      text: '',
    };

    const targetIndex = focusedBlockIndex !== null && focusedBlockIndex >= 0 && focusedBlockIndex < currentNote.blocks.length
      ? focusedBlockIndex + 1
      : currentNote.blocks.length;

    const insertedBlocks = type === 'paragraph' ? [primaryBlock] : [primaryBlock, trailingParagraph];

    captureFlipPositions();
    const nextBlocks = [
      ...currentNote.blocks.slice(0, targetIndex),
      ...insertedBlocks,
      ...currentNote.blocks.slice(targetIndex),
    ];

    persistChange({ ...currentNote, blocks: nextBlocks }, true);
    setFocusedBlockIndex(targetIndex);
    setTimeout(() => {
      blockElementRefs.current[bId1]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }, 60);
  };

  const addTableRow = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    const columnCount = tableBlock.cells[0]?.length || 2;
    const newRow: TableCell[] = Array.from({ length: columnCount }, (_, i) => ({
      text: '',
      align: tableBlock.cells[0]?.[i]?.align || 'left',
    }));
    updateBlock(tableIndex, { ...tableBlock, cells: [...tableBlock.cells, newRow] }, true);
  };

  const removeTableRow = (tableIndex: number, targetRowIndex?: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table' || tableBlock.cells.length <= 1) return;
    const removeIdx = targetRowIndex !== undefined && targetRowIndex >= 0 && targetRowIndex < tableBlock.cells.length
      ? targetRowIndex
      : tableBlock.cells.length - 1;
    const updatedCells = tableBlock.cells.filter((_, idx) => idx !== removeIdx);
    if (removeIdx === 0 && updatedCells.length > 0) {
      updatedCells[0] = updatedCells[0].map((cell) => ({ ...cell, is_header: true }));
    }
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells }, true);
    if (activeTableCell && activeTableCell.blockIndex === tableIndex) {
      setActiveTableCell({
        ...activeTableCell,
        rowIndex: Math.min(activeTableCell.rowIndex, updatedCells.length - 1),
      });
    }
  };

  const addTableColumn = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    const updatedCells = tableBlock.cells.map((row, rIdx) => [
      ...row,
      { text: '', is_header: rIdx === 0, align: 'left' as const },
    ]);
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells }, true);
  };

  const removeTableColumn = (tableIndex: number, targetColIndex?: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table' || (tableBlock.cells[0]?.length || 0) <= 1) return;
    const removeIdx = targetColIndex !== undefined && targetColIndex >= 0 && targetColIndex < (tableBlock.cells[0]?.length || 0)
      ? targetColIndex
      : (tableBlock.cells[0]?.length || 0) - 1;
    const updatedCells = tableBlock.cells.map((row) => row.filter((_, idx) => idx !== removeIdx));
    updateBlock(tableIndex, { ...tableBlock, cells: updatedCells }, true);
    if (activeTableCell && activeTableCell.blockIndex === tableIndex) {
      setActiveTableCell({
        ...activeTableCell,
        colIndex: Math.min(activeTableCell.colIndex, (updatedCells[0]?.length || 1) - 1),
      });
    }
  };

  const toggleTableBorder = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    updateBlock(tableIndex, { ...tableBlock, is_bordered: !tableBlock.is_bordered }, true);
  };

  const toggleTableStriped = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    updateBlock(tableIndex, { ...tableBlock, is_striped: !tableBlock.is_striped }, true);
  };

  const toggleTableCompact = (tableIndex: number) => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[tableIndex];
    if (tableBlock.type !== 'table') return;
    updateBlock(tableIndex, { ...tableBlock, is_compact: !tableBlock.is_compact }, true);
  };

  const [activeDraggingBtnId, setActiveDraggingBtnId] = useState<string | null>(null);
  const [activeJiggleRowIndex, setActiveJiggleRowIndex] = useState<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState<number>(0);

  const buttonDragRef = useRef<{
    blockIndex: number;
    btnIndex: number;
    startX: number;
    startY: number;
    isDragging: boolean;
    timer: number | null;
  } | null>(null);

  const handleBtnTouchStart = (blockIndex: number, btnIndex: number, btnId: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    const timer = window.setTimeout(() => {
      triggerHaptic('rigid');
      setActiveDraggingBtnId(btnId);
      setActiveJiggleRowIndex(blockIndex);
      if (buttonDragRef.current) {
        buttonDragRef.current.isDragging = true;
      }
    }, 320);

    buttonDragRef.current = {
      blockIndex,
      btnIndex,
      startX: touch.clientX,
      startY: touch.clientY,
      isDragging: false,
      timer,
    };
  };

  const handleBtnTouchMove = (blockIndex: number, e: React.TouchEvent) => {
    if (!buttonDragRef.current) return;
    const touch = e.touches[0];
    const diffY = Math.abs(touch.clientY - buttonDragRef.current.startY);
    const diffX = touch.clientX - buttonDragRef.current.startX;

    if (!buttonDragRef.current.isDragging && diffY > 10) {
      if (buttonDragRef.current.timer) {
        clearTimeout(buttonDragRef.current.timer);
        buttonDragRef.current.timer = null;
      }
      return;
    }

    if (buttonDragRef.current.isDragging) {
      e.preventDefault();
      setDragOffsetX(diffX);
      const currentIdx = buttonDragRef.current.btnIndex;
      const block = currentNote.blocks[blockIndex];
      if (block?.type !== 'button_row') return;

      if (diffX > 60 && currentIdx < block.buttons.length - 1) {
        triggerHaptic('medium');
        const nextButtons = [...block.buttons];
        const temp = nextButtons[currentIdx];
        nextButtons[currentIdx] = nextButtons[currentIdx + 1];
        nextButtons[currentIdx + 1] = temp;
        updateBlock(blockIndex, { ...block, buttons: nextButtons }, true);
        buttonDragRef.current.btnIndex = currentIdx + 1;
        buttonDragRef.current.startX = touch.clientX;
        setDragOffsetX(0);
      } else if (diffX < -60 && currentIdx > 0) {
        triggerHaptic('medium');
        const nextButtons = [...block.buttons];
        const temp = nextButtons[currentIdx];
        nextButtons[currentIdx] = nextButtons[currentIdx - 1];
        nextButtons[currentIdx - 1] = temp;
        updateBlock(blockIndex, { ...block, buttons: nextButtons }, true);
        buttonDragRef.current.btnIndex = currentIdx - 1;
        buttonDragRef.current.startX = touch.clientX;
        setDragOffsetX(0);
      }
    }
  };

  const handleBtnTouchEnd = (e: React.TouchEvent) => {
    if (buttonDragRef.current?.timer) {
      clearTimeout(buttonDragRef.current.timer);
    }
    const wasDragging = buttonDragRef.current?.isDragging;
    buttonDragRef.current = null;
    setActiveDraggingBtnId(null);
    setActiveJiggleRowIndex(null);
    setDragOffsetX(0);
    if (wasDragging) {
      e.preventDefault();
      triggerHaptic('light');
    }
  };

  const handleOpenButtonConfig = (blockIndex: number, buttonIndex: number, btn: any) => {
    triggerHaptic('light');
    forceDismissKeyboard();
    setFocusedBlockIndex(blockIndex);
    setEditingButtonModal({
      blockIndex,
      buttonIndex,
      ...btn,
    });
  };

  const setButtonRowAlign = (blockIndex: number, align: 'left' | 'center' | 'right') => {
    triggerHaptic('light');
    const block = currentNote.blocks[blockIndex];
    if (block.type !== 'button_row') return;
    updateBlock(blockIndex, { ...block, align, full_width: false }, true);
  };

  const toggleButtonRowFullWidth = (blockIndex: number) => {
    triggerHaptic('light');
    const block = currentNote.blocks[blockIndex];
    if (block.type !== 'button_row') return;
    updateBlock(blockIndex, { ...block, full_width: !block.full_width }, true);
  };

  const addButtonToRow = (blockIndex: number) => {
    const block = currentNote.blocks[blockIndex];
    if (block.type !== 'button_row') return;
    if (block.buttons.length >= 3) {
      triggerHaptic('heavy');
      alert(t('btn_max_reached'));
      return;
    }
    triggerHaptic('medium');
    const newBtn = {
      id: `btn-${Date.now()}`,
      text: t('btn_new_label'),
      style: 'default' as const,
      type: 'url' as const,
      value: 'https://t.me',
    };
    updateBlock(blockIndex, { ...block, buttons: [...block.buttons, newBtn] }, true);
  };

  const saveEditedButton = () => {
    if (!editingButtonModal) return;
    triggerHaptic('light');
    const { blockIndex, buttonIndex, id, text, style, type, value } = editingButtonModal;
    const block = currentNote.blocks[blockIndex];
    if (block?.type === 'button_row') {
      const nextButtons = [...block.buttons];
      nextButtons[buttonIndex] = { id, text, style, type, value };
      updateBlock(blockIndex, { ...block, buttons: nextButtons }, true);
    }
    setEditingButtonModal(null);
  };

  const deleteButtonFromRow = (blockIndex: number, buttonIndex: number) => {
    triggerHaptic('medium');
    const block = currentNote.blocks[blockIndex];
    if (block?.type === 'button_row') {
      const nextButtons = block.buttons.filter((_, idx) => idx !== buttonIndex);
      if (nextButtons.length === 0) {
        removeBlock(blockIndex);
      } else {
        updateBlock(blockIndex, { ...block, buttons: nextButtons }, true);
      }
    }
    setEditingButtonModal(null);
  };

  const setCellAlignment = (blockIndex: number, rowIndex: number, colIndex: number, align: 'left' | 'center' | 'right') => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[blockIndex];
    if (tableBlock.type !== 'table') return;
    const nextCells = tableBlock.cells.map((row, rI) =>
      row.map((cell, cI) => (rI === rowIndex && cI === colIndex ? { ...cell, align } : cell))
    );
    updateBlock(blockIndex, { ...tableBlock, cells: nextCells }, true);
  };

  const setColumnAlignment = (blockIndex: number, colIndex: number, align: 'left' | 'center' | 'right') => {
    triggerHaptic('light');
    const tableBlock = currentNote.blocks[blockIndex];
    if (tableBlock.type !== 'table') return;
    const nextCells = tableBlock.cells.map((row) =>
      row.map((cell, cI) => (cI === colIndex ? { ...cell, align } : cell))
    );
    updateBlock(blockIndex, { ...tableBlock, cells: nextCells }, true);
  };

  const scrollToHeading = (id: string) => {
    triggerHaptic('light');
    setShowToc(false);
    const el = blockElementRefs.current[id];
    const container = scrollContainerRef.current;
    if (el && container) {
      const headerOffset = 135;
      const elTop = el.getBoundingClientRect().top;
      const containerTop = container.getBoundingClientRect().top;
      const targetScrollTop = container.scrollTop + (elTop - containerTop) - headerOffset;
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      });
      const input = el.querySelector<HTMLInputElement | HTMLElement>('input, [contenteditable="true"]');
      if (input) {
        setTimeout(() => {
          input.focus();
        }, 280);
      }
    }
  };

  const headingsList = currentNote.blocks.filter(
    (b): b is Extract<ContentBlock, { type: 'heading' }> => b.type === 'heading' && b.text.trim().length > 0
  );

  const insertTocIntoNote = () => {
    if (headingsList.length === 0) return;
    triggerHaptic('medium');
    setShowToc(false);
    const tocItemsHtml = headingsList
      .map((h) => `• <a href="#chapter-${h.id}">${h.text}</a>`)
      .join('<br/>');
    const newBlock: ContentBlock = {
      id: `p-toc-${Date.now()}`,
      type: 'paragraph',
      text: tocItemsHtml,
    };
    const targetPos = focusedBlockIndex !== null && focusedBlockIndex >= 0
      ? focusedBlockIndex + 1
      : 0;
    const nextBlocks = [
      ...currentNote.blocks.slice(0, targetPos),
      newBlock,
      ...currentNote.blocks.slice(targetPos),
    ];
    persistChange({ ...currentNote, blocks: nextBlocks }, true);
    setFocusedBlockIndex(targetPos);
  };

  const executeExport = async (payload: any) => {
    const result = await exportNoteToTelegram(payload);
    if (result.success) {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      setExportNotice(t('exported'));
      setIsExporting(false);
      setTimeout(() => setExportNotice(null), 2500);
      return;
    }

    if (result.error === 'NEED_START_BOT') {
      setIsExporting(false);
      setBotPromptModal({ isOpen: true, botUsername: result.bot_username || '' });
      return;
    }

    if (result.error === 'NEED_WRITE_ACCESS' && window.Telegram?.WebApp?.requestWriteAccess) {
      window.Telegram.WebApp.requestWriteAccess(async (allowed: boolean) => {
        if (allowed) {
          const retryResult = await exportNoteToTelegram(payload);
          if (retryResult.success) {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
            setExportNotice(t('exported'));
          } else {
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
            setExportNotice(t('export_failed'));
          }
        } else {
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
          setExportNotice(t('export_failed'));
        }
        setIsExporting(false);
        setTimeout(() => setExportNotice(null), 2500);
      });
      return;
    }

    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
    setExportNotice(t('export_failed'));
    setIsExporting(false);
    setTimeout(() => setExportNotice(null), 2500);
  };

  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [selectedExportChannels, setSelectedExportChannels] = useState<string[]>([]);
  const [sendToUserChat, setSendToUserChat] = useState<boolean>(true);

  const toggleChannelSelection = (chId: string) => {
    triggerHaptic('light');
    setSelectedExportChannels((prev) =>
      prev.includes(chId) ? prev.filter((id) => id !== chId) : [...prev, chId]
    );
  };

  const handleExport = async () => {
    if (selectedExportChannels.length > 0) {
      const adUrl = 'https://omg10.com/4/11046598';
      const tg = window.Telegram?.WebApp;
      try {
        if (tg?.openLink) {
          tg.openLink(adUrl);
        } else {
          window.open(adUrl, '_blank');
        }
      } catch (e) {
        console.warn('LINK_OPEN_FALLBACK', e);
      }
    }

    triggerHaptic('medium');
    setIsExporting(true);
    const richBlocks: any[] = [];
    const cleanTitle = currentNote.title.trim();
    if (cleanTitle) {
      const titleLines = cleanTitle.split('\n').map((l) => l.trim()).filter(Boolean);
      if (titleLines.length > 0) {
        richBlocks.push({ type: 'heading', size: 1, text: titleLines[0] });
        for (let i = 1; i < titleLines.length; i++) {
          richBlocks.push({ type: 'paragraph', text: titleLines[i] });
        }
      }
    }
    currentNote.blocks.forEach((b) => {
      if (b.type === 'heading') {
        richBlocks.push({ type: 'heading', size: b.size, text: b.text, id: b.id });
      } else if (b.type === 'paragraph') {
        if (b.text && b.text.trim()) {
          richBlocks.push({ type: 'paragraph', text: b.text });
        }
      } else if (b.type === 'quote') {
        richBlocks.push({
          type: 'blockquote',
          blocks: [{ type: 'paragraph', text: b.text }],
          credit: b.credit,
        });
      } else if (b.type === 'expandable_quote') {
        richBlocks.push({
          type: 'expandable_blockquote',
          text: b.text,
          credit: b.credit,
        });
      } else if (b.type === 'pullquote') {
        richBlocks.push({
          type: 'pullquote',
          text: b.text,
          credit: b.credit,
        });
      } else if (b.type === 'list') {
        richBlocks.push({
          type: 'list',
          items: b.items.map((i, idx) => ({
            label: b.style === 'ordered' ? `${idx + 1}.` : undefined,
            has_checkbox: b.style === 'task',
            is_checked: i.is_checked,
            blocks: [{ type: 'paragraph', text: i.text }],
          })),
        });
      } else if (b.type === 'table') {
        richBlocks.push({
          type: 'table',
          is_bordered: b.is_bordered,
          is_striped: b.is_striped,
          is_compact: b.is_compact,
          cells: b.cells,
        });
      } else if (b.type === 'code') {
        richBlocks.push({ type: 'pre', text: b.text, language: b.language });
      } else if (b.type === 'math') {
        richBlocks.push({ type: 'mathematical_expression', expression: b.expression });
      } else if (b.type === 'details') {
        richBlocks.push({
          type: 'details',
          summary: b.summary,
          blocks: [{ type: 'paragraph', text: b.text }],
          is_open: Boolean(b.is_open),
        });
      } else if (b.type === 'divider') {
        richBlocks.push({ type: 'divider' });
      } else if (b.type === 'media' && b.images && b.images.length > 0) {
        richBlocks.push({
          type: 'media',
          layout: b.layout || (b.images.length > 1 ? 'collage' : 'single'),
          images: b.images.map((img) => img.url),
          caption: b.caption || '',
        });
      } else if (b.type === 'audio') {
        const isSupportedAudio = /\.(mp3|ogg)(\?.*)?$/i.test(b.url);
        if (isSupportedAudio) {
          richBlocks.push({
            type: 'audio',
            url: b.url,
            caption: b.caption || '',
          });
        } else {
          richBlocks.push({
            type: 'document',
            url: b.url,
            caption: b.caption || '',
          });
        }
      } else if (b.type === 'file') {
        richBlocks.push({
          type: 'document',
          url: b.url,
          caption: b.caption || '',
        });
      } else if (b.type === 'button_row') {
        richBlocks.push({
          type: 'button_row',
          align: b.full_width ? undefined : (b.align || 'center'),
          full_width: Boolean(b.full_width),
          buttons: b.buttons.map((btn) => ({
            text: btn.text,
            style: btn.style === 'default' ? undefined : btn.style,
            type: btn.type,
            url: btn.type === 'url' ? btn.value : undefined,
            copy_text: btn.type === 'copy_text' ? btn.value : undefined,
          })),
        });
      } else if (b.type === 'footer') {
        if (b.text && b.text.trim()) {
          richBlocks.push({
            type: 'footer',
            text: b.text,
          });
        }
      }
    });

    const exportPayload = {
      note_id: currentNote.id,
      note: {
        ...currentNote,
        blocks: richBlocks as any,
      },
      target_channel_ids: selectedExportChannels,
      send_to_user: sendToUserChat,
    };
    await executeExport(exportPayload);
    setShowExportModal(false);
  };

  return (
    <div
      ref={scrollContainerRef}
      className="flex flex-col w-full h-full overflow-y-auto overflow-x-hidden px-6 animate-page-fade relative"
      style={{ paddingBottom: 'calc(var(--keyboard-inset, 0px) + 5rem)' }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="opacity-0 absolute -z-10 w-0 h-0 pointer-events-none"
        tabIndex={-1}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        onChange={handleAudioFileSelected}
        className="opacity-0 absolute -z-10 w-0 h-0 pointer-events-none"
        tabIndex={-1}
      />
      <input
        ref={docFileInputRef}
        type="file"
        onChange={handleDocFileSelected}
        className="opacity-0 absolute -z-10 w-0 h-0 pointer-events-none"
        tabIndex={-1}
      />
      <div className="sticky top-0 z-30 bg-[#FAF8F5]/95 safe-header-box pb-2 border-b border-cream-divider flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                triggerHaptic();
                setShowToc(!showToc);
              }}
              className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all active:scale-95 ${
                showToc
                  ? 'bg-warm-accent text-white border-warm-accent shadow-xs'
                  : 'bg-cream-surface/80 text-warm-muted border-cream-divider/70 hover:text-warm-text'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">toc</span>
            </button>
            <div className="flex items-center bg-cream-surface/80 rounded-full border border-cream-divider/70 p-0.5">
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="w-6 h-6 rounded-full flex items-center justify-center text-warm-muted hover:text-warm-text disabled:opacity-20 active:scale-90 transition-transform"
              >
                <span className="material-symbols-outlined text-[14px]">undo</span>
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="w-6 h-6 rounded-full flex items-center justify-center text-warm-muted hover:text-warm-text disabled:opacity-20 active:scale-90 transition-transform"
              >
                <span className="material-symbols-outlined text-[14px]">redo</span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                triggerHaptic('light');
                forceDismissKeyboard();
                setShowExportModal(true);
              }}
              disabled={isExporting}
              className={`h-7 px-3 rounded-full text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-80 ${
                selectedExportChannels.length > 0
                  ? 'bg-warm-accent text-[#FAF8F5]'
                  : 'bg-warm-text text-[#FAF8F5]'
              }`}
            >
              {isExporting ? (
                <>
                  <div className="w-2.5 h-2.5 rounded-full border-[1.5px] border-white/20 border-t-white animate-spin" />
                  <span className="text-[11px] font-normal">{t('exporting')}</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[13px]">
                    {selectedExportChannels.length > 0 ? 'campaign' : 'ios_share'}
                  </span>
                  <span>
                    {exportNotice ||
                      (selectedExportChannels.length > 0
                        ? t('export_with_ad')
                        : t('export_rich'))}
                  </span>
                </>
              )}
            </button>
            <button
              onClick={() => {
                triggerHaptic('medium');
                if (window.confirm(t('delete_confirm'))) {
                  onDelete(currentNote.id);
                }
              }}
              className="w-7 h-7 rounded-full flex items-center justify-center text-warm-subtle hover:text-red-600 active:scale-90 transition-all"
            >
              <span className="material-symbols-outlined text-[16px]">delete_outline</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          {topics.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                triggerHaptic();
                persistChange({ ...currentNote, category: cat.id }, true);
              }}
              className={`text-[10px] px-2.5 py-0.5 rounded-full font-medium uppercase tracking-wider shrink-0 transition-colors ${
                currentNote.category === cat.id
                  ? 'bg-warm-accent text-white'
                  : 'text-warm-muted hover:text-warm-text hover:bg-cream-surface/60'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-b border-cream-divider/40 pb-1 text-xs">
          {(['text', 'lists', 'quotes', 'media', 'table', 'objects'] as const).map((tabKey) => {
            const isActive = activeToolbarTab === tabKey;
            const labelKey = `tab_${tabKey}` as any;
            return (
              <button
                key={tabKey}
                onClick={() => {
                  triggerHaptic();
                  setActiveToolbarTab(tabKey);
                }}
                className={`pb-1 px-1 font-medium text-xs transition-colors relative ${
                  isActive ? 'text-warm-accent font-semibold' : 'text-warm-muted'
                }`}
              >
                <span>{t(labelKey)}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-warm-accent rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        <div key={activeToolbarTab} className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 animate-toolbar-fade">
          {activeToolbarTab === 'text' && (
            <>
              <button
                onClick={() => appendBlockWithParagraph('paragraph')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span>{t('tool_paragraph')}</span>
              </button>
              {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => appendBlockWithParagraph('heading', { size: lvl })}
                  className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium shrink-0 physics-bounce"
                >
                  <span>H{lvl}</span>
                </button>
              ))}
            </>
          )}

          {activeToolbarTab === 'lists' && (
            <>
              <button
                onClick={() => appendBlockWithParagraph('list', { style: 'task' })}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">check_box</span>
                <span>{t('tool_task')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('list', { style: 'bullet' })}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">format_list_bulleted</span>
                <span>{t('tool_bullet')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('list', { style: 'ordered' })}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">format_list_numbered</span>
                <span>{t('tool_numbered')}</span>
              </button>
            </>
          )}

          {activeToolbarTab === 'quotes' && (
  <>
    <button
      onClick={() => appendBlockWithParagraph('quote')}
      className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
    >
      <span>{t('tool_quote_block')}</span>
    </button>
    <button
      onClick={() => appendBlockWithParagraph('expandable_quote')}
      className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
    >
      <span>{t('tool_quote_expand')}</span>
    </button>
    <button
      onClick={() => appendBlockWithParagraph('pullquote')}
      className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
    >
      <span>{t('tool_quote_pull')}</span>
    </button>
  </>
)}
{activeToolbarTab === 'media' && (
  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
    <button
      type="button"
      onClick={() => appendBlockWithParagraph('media')}
      disabled={totalImageCount >= 2 || isUploadingGlobal}
      className="px-2.5 py-1 rounded-full bg-warm-accent text-white text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce disabled:opacity-40"
    >
      {isUploadingGlobal && uploadingMediaType === 'image' ? (
        <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin-fast" />
      ) : (
        <span className="material-symbols-outlined text-[14px]">image</span>
      )}
      <span>{t('tool_image')}</span>
      <span className="text-[10px] font-mono opacity-80">{totalImageCount}/2</span>
    </button>
    <button
      type="button"
      onClick={triggerUploadAudio}
      disabled={totalAudioCount >= 1 || isUploadingGlobal}
      className="px-2.5 py-1 rounded-full bg-cream-surface text-warm-text text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce disabled:opacity-40"
    >
      {isUploadingGlobal && uploadingMediaType === 'audio' ? (
        <div className="w-3 h-3 border-2 border-warm-accent border-t-transparent rounded-full animate-spin-fast" />
      ) : (
        <span className="material-symbols-outlined text-[14px] text-warm-accent">audiotrack</span>
      )}
      <span>{t('tool_audio')}</span>
      <span className="text-[10px] font-mono text-warm-muted">{totalAudioCount}/1</span>
    </button>
    <button
      type="button"
      onClick={triggerUploadDoc}
      disabled={totalFileCount >= 1 || isUploadingGlobal}
      className="px-2.5 py-1 rounded-full bg-cream-surface text-warm-text text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce disabled:opacity-40"
    >
      {isUploadingGlobal && uploadingMediaType === 'file' ? (
        <div className="w-3 h-3 border-2 border-warm-accent border-t-transparent rounded-full animate-spin-fast" />
      ) : (
        <span className="material-symbols-outlined text-[14px] text-warm-accent">attach_file</span>
      )}
      <span>{t('tool_file')}</span>
      <span className="text-[10px] font-mono text-warm-muted">{totalFileCount}/1</span>
    </button>
  </div>
)}
{activeToolbarTab === 'table' && (
            <button
              onClick={() => appendBlockWithParagraph('table')}
              className="px-3 py-1 rounded-full bg-warm-accent text-white text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
            >
              <span className="material-symbols-outlined text-[14px]">table_rows</span>
              <span>{t('tool_table')}</span>
            </button>
          )}

          {activeToolbarTab === 'objects' && (
            <>
              <button
                onClick={() => appendBlockWithParagraph('code')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">code</span>
                <span>{t('tool_code')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('math')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">functions</span>
                <span>{t('tool_math')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('details')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">unfold_more</span>
                <span>{t('tool_details')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('divider')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px]">horizontal_rule</span>
                <span>{t('tool_divider')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('button_row')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px] text-warm-accent">smart_button</span>
                <span>{t('tool_button')}</span>
              </button>
              <button
                onClick={() => appendBlockWithParagraph('footer')}
                className="px-2.5 py-1 rounded-full bg-cream-surface text-xs font-medium flex items-center gap-1 shrink-0 physics-bounce"
              >
                <span className="material-symbols-outlined text-[14px] text-warm-accent">short_text</span>
                <span>{t('tool_footer')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {showToc && (
         <div className="my-2 p-3 rounded-xl bg-cream-surface border border-cream-divider animate-toc-down shadow-sm">
           <div className="flex items-center justify-between pb-2 border-b border-cream-divider/60">
             <span className="text-xs font-semibold text-warm-text uppercase tracking-wider">{t('toc_title')}</span>
             <button onClick={() => setShowToc(false)} className="text-warm-muted hover:text-warm-text">
               <span className="material-symbols-outlined text-[16px]">close</span>
             </button>
           </div>
           <div className="flex flex-col gap-1.5 pt-2 max-h-48 overflow-y-auto">
                 {headingsList.length === 0 ? (
                   <span className="text-xs text-warm-subtle italic">{t('toc_empty')}</span>
                 ) : (
                   headingsList.map((hBlock) => {
                     const indentStyles: Record<number, string> = {
                       1: 'pl-1 text-[13px] font-bold text-warm-text',
                       2: 'pl-3 text-xs font-semibold text-warm-text',
                       3: 'pl-5 text-xs font-medium text-warm-text',
                       4: 'pl-7 text-xs font-normal text-warm-muted',
                       5: 'pl-9 text-[11px] font-normal text-warm-muted',
                       6: 'pl-11 text-[11px] font-normal text-warm-subtle',
                     };
                     const styleClass = indentStyles[hBlock.size] || indentStyles[2];
                     return (
                       <button
                         key={hBlock.id}
                         onClick={() => scrollToHeading(hBlock.id)}
                         className={`text-left transition-colors truncate hover:text-warm-accent ${styleClass}`}
                       >
                         {hBlock.text}
                       </button>
                     );
                   })
                 )}
           </div>
           {headingsList.length > 0 && (
             <div className="pt-2 mt-1 border-t border-cream-divider/50 flex justify-end">
               <button
                 type="button"
                 onClick={insertTocIntoNote}
                 className="text-[11px] font-semibold text-warm-accent hover:underline flex items-center gap-1 active:opacity-70 transition-opacity"
               >
                 <span className="material-symbols-outlined text-[13px]">format_list_bulleted</span>
                 <span>{t('toc_insert_button')}</span>
               </button>
             </div>
           )}
         </div>
       )}

      <div className="flex flex-col pt-3">
        <textarea
          rows={1}
          value={currentNote.title}
          placeholder={t('title_placeholder')}
          onFocus={() => setFocusedBlockIndex(null)}
          onInput={(e) => autoResize(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              triggerHaptic('light');
              const firstBlock = currentNote.blocks[0];
              if (firstBlock) {
                const el = blockElementRefs.current[firstBlock.id];
                const editable = el?.querySelector<HTMLElement>('[contenteditable="true"], input, textarea');
                editable?.focus();
              }
            }
          }}
          onChange={(e) => handleTitleChange(e.target.value.replace(/\r?\n/g, ' '))}
          className="text-2xl font-bold tracking-tight text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle w-full mb-3 resize-none overflow-hidden"
        />

        <div className="flex flex-col gap-1.5 min-h-[300px] w-full min-w-0">
          {currentNote.blocks.map((block, index) => (
            <div
              key={block.id}
              ref={(el) => {
                blockElementRefs.current[block.id] = el;
              }}
              className="relative group flex items-start gap-1 w-full min-w-0 animate-block-enter"
            >
              <div className="flex-1 min-w-0 w-full">
                {block.type === 'paragraph' && (
                  <EditableBlock
                    html={block.text}
                    placeholder={t('paragraph_placeholder')}
                    onFocus={() => setFocusedBlockIndex(index)}
                    onAnchorClick={(href) => {
                      if (href.startsWith('#')) {
                        const targetId = href.replace(/^#chapter-/, '').replace(/^#/, '');
                        scrollToHeading(targetId);
                      }
                    }}
                    onChange={(newHtml) => updateBlock(index, { ...block, text: newHtml })}
                    onKeyDown={(e) => handleParagraphKeyDown(e, index)}
                    className="w-full text-[15px] leading-relaxed text-warm-text bg-transparent border-none focus:outline-none min-h-[24px] py-0.5"
                  />
                )}

                {block.type === 'heading' && (
                  <textarea
                    rows={1}
                    value={block.text}
                    placeholder={`${t('heading_placeholder')} (H${block.size})`}
                    ref={(el) => {
                      if (el) autoResize(el);
                    }}
                    onFocus={() => setFocusedBlockIndex(index)}
                    onInput={(e) => autoResize(e.currentTarget)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        triggerHaptic('light');
                        const newBlockId = `p-${Date.now()}`;
                        const newBlock: ContentBlock = {
                          id: newBlockId,
                          type: 'paragraph',
                          text: '',
                        };
                        const nextBlocks = [
                          ...currentNote.blocks.slice(0, index + 1),
                          newBlock,
                          ...currentNote.blocks.slice(index + 1),
                        ];
                        persistChange({ ...currentNote, blocks: nextBlocks }, true);
                        setFocusedBlockIndex(index + 1);
                        setTimeout(() => {
                          const el = blockElementRefs.current[newBlockId];
                          const editable = el?.querySelector<HTMLDivElement>('[contenteditable="true"]');
                          if (editable) {
                            setCaretToStart(editable);
                          }
                        }, 30);
                      } else if (e.key === 'Backspace' && block.text === '') {
                        e.preventDefault();
                        triggerHaptic('light');
                        removeBlock(index);
                        if (index > 0) {
                          const prevBlock = currentNote.blocks[index - 1];
                          if (prevBlock) {
                            setTimeout(() => {
                              const prevEl = blockElementRefs.current[prevBlock.id];
                              const targetFocus = prevEl?.querySelector<HTMLElement>('[contenteditable="true"], input, textarea');
                              targetFocus?.focus();
                            }, 40);
                          }
                        }
                      }
                    }}
                    onChange={(e) => updateBlock(index, { ...block, text: e.target.value.replace(/\r?\n/g, ' ') })}
                    className={`w-full font-semibold tracking-tight text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle pt-0.5 resize-none overflow-hidden break-words ${
                      block.size === 1
                        ? 'text-xl font-bold'
                        : block.size === 2
                        ? 'text-lg font-bold'
                        : block.size === 3
                        ? 'text-base font-semibold'
                        : 'text-sm font-medium'
                    }`}
                  />
                )}

                {block.type === 'quote' && (
                  <div className="w-full my-1.5 rounded-r-xl border-l-[3.5px] border-warm-accent bg-cream-surface/75 px-3 py-2.5 flex flex-col gap-1.5 transition-all">
                    <EditableBlock
                      html={block.text}
                      placeholder={t('quote_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(newHtml) => updateBlock(index, { ...block, text: newHtml })}
                      className="w-full text-[14.5px] text-warm-text leading-relaxed bg-transparent border-none focus:outline-none min-h-[22px]"
                    />
                    <input
                      type="text"
                      value={block.credit || ''}
                      placeholder={t('quote_credit_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, credit: e.target.value })}
                      className="w-full text-[11px] font-medium text-warm-accent bg-transparent border-none focus:outline-none tracking-wide"
                    />
                  </div>
                )}
                {block.type === 'expandable_quote' && (
                  <div className="w-full my-1.5 rounded-r-xl border-l-[3.5px] border-warm-accent bg-cream-surface/75 px-3 py-2.5 flex flex-col gap-1.5 transition-all">
                    <div className="flex items-center justify-between pb-1 border-b border-cream-divider/50">
                      <span className="text-[10px] font-semibold text-warm-accent uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">unfold_more</span>
                        <span>{t('tool_quote_expand')}</span>
                      </span>
                    </div>
                    <EditableBlock
                      html={block.text}
                      placeholder={t('quote_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(newHtml) => updateBlock(index, { ...block, text: newHtml })}
                      className="w-full text-[14.5px] text-warm-text leading-relaxed bg-transparent border-none focus:outline-none min-h-[22px]"
                    />
                    <input
                      type="text"
                      value={block.credit || ''}
                      placeholder={t('quote_credit_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, credit: e.target.value })}
                      className="w-full text-[11px] font-medium text-warm-accent bg-transparent border-none focus:outline-none tracking-wide"
                    />
                  </div>
                )}
                {block.type === 'pullquote' && (
                  <div className="my-2 py-2 px-3 border-y border-cream-divider text-center flex flex-col gap-1">
                    <EditableBlock
                      html={block.text}
                      placeholder={t('quote_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(newHtml) => updateBlock(index, { ...block, text: newHtml })}
                      className="w-full text-base font-serif italic text-warm-text text-center bg-transparent border-none focus:outline-none min-h-[24px]"
                    />
                    <input
                      type="text"
                      value={block.credit || ''}
                      placeholder={t('quote_credit_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, credit: e.target.value })}
                      className="w-full text-xs font-medium text-warm-accent text-center bg-transparent border-none focus:outline-none"
                    />
                  </div>
                )}

                {block.type === 'list' && (
                  <div className="flex flex-col gap-1.5 py-1">
                    {block.items.map((item, itemIdx) => (
                      <div key={item.id} className="flex items-start gap-2">
                        {block.style === 'task' ? (
                          <button
                            type="button"
                            onClick={() => {
                              triggerHaptic();
                              const newItems = [...block.items];
                              newItems[itemIdx].is_checked = !newItems[itemIdx].is_checked;
                              updateBlock(index, { ...block, items: newItems }, true);
                            }}
                            className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 mt-0.5 ${
                              item.is_checked ? 'bg-[#5F7466] text-white' : 'border border-warm-subtle bg-transparent'
                            }`}
                          >
                            {item.is_checked && (
                              <span className="material-symbols-outlined text-[13px] font-bold">check</span>
                            )}
                          </button>
                        ) : block.style === 'ordered' ? (
                          <span className="text-xs font-mono text-warm-accent font-semibold w-4 text-center shrink-0 mt-0.5">
                            {itemIdx + 1}.
                          </span>
                        ) : (
                          <span className="text-base text-warm-accent leading-none w-4 text-center shrink-0 mt-0.5">•</span>
                        )}
                        <textarea
                          rows={1}
                          id={item.id}
                          value={item.text}
                          placeholder={t('task_placeholder')}
                          ref={(el) => {
                            if (el) autoResize(el);
                          }}
                          onInput={(e) => autoResize(e.currentTarget)}
                          onFocus={() => setFocusedBlockIndex(index)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              triggerHaptic('light');
                              const newTaskId = `task-${Date.now()}`;
                              const newItems = [...block.items];
                              newItems.splice(itemIdx + 1, 0, {
                                id: newTaskId,
                                text: '',
                                is_checked: false,
                              });
                              updateBlock(index, { ...block, items: newItems }, true);
                              setTimeout(() => {
                                const nextEl = document.getElementById(newTaskId) as HTMLTextAreaElement | null;
                                if (nextEl) {
                                  nextEl.focus();
                                  autoResize(nextEl);
                                }
                              }, 50);
                            } else if (e.key === 'Backspace' && item.text === '' && block.items.length > 1) {
                              e.preventDefault();
                              triggerHaptic('light');
                              const newItems = block.items.filter((_, i) => i !== itemIdx);
                              updateBlock(index, { ...block, items: newItems }, true);
                              const prevItem = block.items[itemIdx - 1];
                              if (prevItem) {
                                setTimeout(() => {
                                  const prevEl = document.getElementById(prevItem.id) as HTMLTextAreaElement | null;
                                  if (prevEl) {
                                    prevEl.focus();
                                    autoResize(prevEl);
                                  }
                                }, 50);
                              }
                            }
                          }}
                          onChange={(e) => {
                            const newItems = [...block.items];
                            newItems[itemIdx].text = e.target.value.replace(/\r?\n/g, ' ');
                            updateBlock(index, { ...block, items: newItems }, false);
                          }}
                          className={`text-sm bg-transparent border-none focus:outline-none flex-1 p-0 leading-5 resize-none overflow-hidden break-words w-full ${
                            item.is_checked ? 'line-through text-warm-muted' : 'text-warm-text'
                          }`}
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic();
                        const newTaskId = `task-${Date.now()}`;
                        const newItems = [
                          ...block.items,
                          { id: newTaskId, text: '', is_checked: false },
                        ];
                        updateBlock(index, { ...block, items: newItems }, true);
                        setTimeout(() => {
                          const nextEl = document.getElementById(newTaskId) as HTMLTextAreaElement | null;
                          if (nextEl) {
                            nextEl.focus();
                            autoResize(nextEl);
                          }
                        }, 50);
                      }}
                      className="text-xs text-warm-accent font-medium self-start flex items-center gap-1 mt-0.5"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      <span>{t('add_task_item')}</span>
                    </button>
                  </div>
                )}
                
                {block.type === 'audio' && (
                  <div className="my-2.5 p-3 rounded-2xl bg-cream-surface/75 border border-cream-divider/80 flex flex-col gap-2.5 shadow-xs w-full min-w-0 transition-all">
                    <div className="flex items-center justify-between gap-2 border-b border-cream-divider/50 pb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-warm-accent/10 text-warm-accent flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">audiotrack</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-warm-text truncate">{block.name}</span>
                          <span className="text-[10px] font-mono text-warm-muted">{formatFileSize(block.size)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeBlock(index)}
                        className="w-6 h-6 rounded-full text-warm-subtle hover:text-red-600 flex items-center justify-center physics-bounce"
                      >
                        <span className="material-symbols-outlined text-[15px]">close</span>
                      </button>
                    </div>
                    <audio
                      controls
                      preload="none"
                      src={block.url}
                      className="w-full h-8 rounded-lg outline-none"
                    />
                    <div className="border-t border-cream-divider/40 pt-1">
                      <input
                        type="text"
                        value={block.caption || ''}
                        placeholder={t('audio_caption_placeholder')}
                        onFocus={() => setFocusedBlockIndex(index)}
                        onChange={(e) => updateBlock(index, { ...block, caption: e.target.value })}
                        className="w-full text-xs font-normal text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle"
                      />
                    </div>
                  </div>
                )}
                {block.type === 'file' && (
                  <div className="my-2.5 p-3 rounded-2xl bg-cream-surface/75 border border-cream-divider/80 flex flex-col gap-2 shadow-xs w-full min-w-0 transition-all">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={block.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 min-w-0 flex-1 group/doc no-underline"
                      >
                        <div className="w-8 h-8 rounded-xl bg-warm-text text-[#FAF8F5] flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">attachment</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-warm-text group-hover/doc:text-warm-accent truncate transition-colors no-underline">{block.name}</span>
                          <span className="text-[10px] font-mono text-warm-muted">{formatFileSize(block.size)}</span>
                        </div>
                      </a>
                      <button
                        type="button"
                        onClick={() => removeBlock(index)}
                        className="w-6 h-6 rounded-full text-warm-subtle hover:text-red-600 flex items-center justify-center physics-bounce"
                      >
                        <span className="material-symbols-outlined text-[15px]">close</span>
                      </button>
                    </div>
                    <div className="pt-1">
                      <input
                        type="text"
                        value={block.caption || ''}
                        placeholder={t('file_caption_placeholder')}
                        onFocus={() => setFocusedBlockIndex(index)}
                        onChange={(e) => updateBlock(index, { ...block, caption: e.target.value })}
                        className="w-full text-xs font-normal text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle"
                      />
                    </div>
                  </div>
                )}
                {block.type === 'media' && (
                  <div className="flex flex-col gap-2 my-2 w-full min-w-0">
                    {block.images.length === 2 && (
                      <div className="flex items-center justify-between pb-1">
                        <div className="flex items-center bg-cream-surface border border-cream-divider rounded-full p-0.5">
                          <button
                            type="button"
                            onClick={() => toggleMediaLayout(index, 'collage')}
                            className={`px-3 py-0.5 text-xs font-medium rounded-full transition-all duration-200 flex items-center gap-1 ${
                              block.layout === 'collage'
                                ? 'bg-warm-accent text-white'
                                : 'text-warm-muted hover:text-warm-text'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">grid_view</span>
                            <span>{t('layout_collage')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleMediaLayout(index, 'slideshow')}
                            className={`px-3 py-0.5 text-xs font-medium rounded-full transition-all duration-200 flex items-center gap-1 ${
                              block.layout === 'slideshow'
                                ? 'bg-warm-accent text-white'
                                : 'text-warm-muted hover:text-warm-text'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">view_carousel</span>
                            <span>{t('layout_slideshow')}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="relative w-full rounded-xl overflow-hidden bg-cream-surface/60 border border-cream-divider">
                      {block.layout === 'slideshow' && block.images.length === 2 ? (
                        <div className="relative w-full flex flex-col items-center">
                          <div className="relative w-full h-56 overflow-hidden">
                            {block.images.map((img, imgIdx) => {
                              const activeIdx = activeSlideIndices[block.id] || 0;
                              const isCurrent = activeIdx === imgIdx;
                              return (
                                <div
                                    key={img.id}
                                    className={`absolute inset-0 transition-opacity duration-300 ease-out flex items-center justify-center ${
                                      isCurrent ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'
                                    }`}
                                  >
                                    <img
                                      src={img.url}
                                      alt="slideshow frame"
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeImageFromBlock(index, imgIdx)}
                                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#24201D]/75 text-white flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">close</span>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="w-full flex items-center justify-between px-3 py-1.5 bg-cream-surface/80 border-t border-cream-divider">
                              <button
                                type="button"
                                onClick={() => handleSlideNav(block.id, 'prev', block.images.length)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-warm-text hover:bg-cream-divider transition-colors"
                              >
                                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                              </button>
                              <div className="flex items-center gap-1.5">
                                {block.images.map((_, dotIdx) => {
                                  const activeIdx = activeSlideIndices[block.id] || 0;
                                  return (
                                    <span
                                      key={dotIdx}
                                      className={`w-2 h-2 rounded-full transition-colors ${
                                        activeIdx === dotIdx ? 'bg-warm-accent' : 'bg-cream-divider'
                                      }`}
                                    />
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSlideNav(block.id, 'next', block.images.length)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-warm-text hover:bg-cream-divider transition-colors"
                              >
                                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                              </button>
                            </div>
                          </div>
                        ) : block.layout === 'collage' && block.images.length === 2 ? (
                          <div className="grid grid-cols-2 gap-1.5 p-1.5 transition-all duration-200">
                            {block.images.map((img, imgIdx) => (
                              <div key={img.id} className="relative h-44 rounded-lg overflow-hidden group/img">
                                <img
                                  src={img.url}
                                  alt="collage thumb"
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeImageFromBlock(index, imgIdx)}
                                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#24201D]/75 text-white flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[14px]">close</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="relative w-full max-h-72 overflow-hidden flex items-center justify-center">
                            {block.images[0] && (
                              <>
                                <img
                                  src={block.images[0].url}
                                  alt="single preview"
                                  className="w-full max-h-72 object-cover rounded-xl"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeImageFromBlock(index, 0)}
                                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#24201D]/75 text-white flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[14px]">close</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}

                      {uploadingBlockId === block.id && (
                        <div className="absolute inset-0 bg-[#FAF8F5]/85 flex items-center justify-center z-20">
                          <div className="flex items-center gap-2 text-xs font-medium text-warm-accent">
                            <div className="w-4 h-4 border-2 border-warm-accent/30 border-t-warm-accent rounded-full animate-spin-fast" />
                            <span>{t('image_uploading')}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {block.images.length === 1 && totalImageCount < 2 && (
                      <button
                        type="button"
                        onClick={() => triggerAddSecondImage(index)}
                        disabled={isUploadingGlobal}
                        className="self-start text-xs font-medium text-warm-accent flex items-center gap-1 px-2.5 py-1 rounded-full bg-cream-surface border border-cream-divider physics-bounce disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[14px]">add</span>
                        <span>{t('add_second_image')}</span>
                      </button>
                    )}

                    <div className="border-b border-cream-divider/70 pb-1">
                      <input
                        type="text"
                        value={block.caption || ''}
                        placeholder={t('image_caption_placeholder')}
                        onFocus={() => setFocusedBlockIndex(index)}
                        onChange={(e) => updateBlock(index, { ...block, caption: e.target.value })}
                        className="w-full text-xs font-normal text-warm-text bg-transparent border-none focus:outline-none placeholder:text-warm-subtle"
                      />
                    </div>
                  </div>
                )}
                {block.type === 'table' && (
                  <div className="flex flex-col gap-1.5 my-3 w-full min-w-0 max-w-full">
                    <div
                      className={`relative w-full min-w-0 max-w-full rounded-xl overflow-hidden bg-[#FAF8F5] transition-all duration-150 ${
                        block.is_bordered ? 'border border-cream-divider' : 'border border-transparent'
                      }`}
                    >
                      <div
                        className={`flex items-center justify-between px-2.5 py-1.5 bg-cream-surface overflow-x-auto no-scrollbar gap-2 ${
                          block.is_bordered ? 'border-b border-cream-divider' : ''
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <div
                            className={`flex items-center bg-[#FAF8F5] border border-cream-divider rounded-lg p-0.5 transition-all duration-200 ease-out origin-left ${
                              activeTableCell && activeTableCell.blockIndex === index
                                ? 'opacity-100 scale-100 max-w-[96px] mr-1 pointer-events-auto'
                                : 'opacity-0 scale-90 max-w-0 mr-0 pointer-events-none p-0 border-transparent overflow-hidden'
                            }`}
                          >
                            <button
                              type="button"
                              tabIndex={activeTableCell && activeTableCell.blockIndex === index ? 0 : -1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => activeTableCell && setCellAlignment(index, activeTableCell.rowIndex, activeTableCell.colIndex, 'left')}
                              className="w-6 h-6 flex items-center justify-center rounded text-warm-muted hover:text-warm-text active:scale-90 transition-transform"
                            >
                              <span className="material-symbols-outlined text-[14px]">format_align_left</span>
                            </button>
                            <button
                              type="button"
                              tabIndex={activeTableCell && activeTableCell.blockIndex === index ? 0 : -1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => activeTableCell && setCellAlignment(index, activeTableCell.rowIndex, activeTableCell.colIndex, 'center')}
                              className="w-6 h-6 flex items-center justify-center rounded text-warm-muted hover:text-warm-text active:scale-90 transition-transform"
                            >
                              <span className="material-symbols-outlined text-[14px]">format_align_center</span>
                            </button>
                            <button
                              type="button"
                              tabIndex={activeTableCell && activeTableCell.blockIndex === index ? 0 : -1}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => activeTableCell && setCellAlignment(index, activeTableCell.rowIndex, activeTableCell.colIndex, 'right')}
                              className="w-6 h-6 flex items-center justify-center rounded text-warm-muted hover:text-warm-text active:scale-90 transition-transform"
                            >
                              <span className="material-symbols-outlined text-[14px]">format_align_right</span>
                            </button>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => toggleTableBorder(index)}
                              className={`p-1 rounded-lg transition-colors active:scale-90 ${
                                block.is_bordered ? 'text-warm-accent bg-warm-accent-light' : 'text-warm-muted hover:text-warm-text'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[15px]">border_all</span>
                            </button>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => toggleTableStriped(index)}
                              className={`p-1 rounded-lg transition-colors active:scale-90 ${
                                block.is_striped ? 'text-warm-accent bg-warm-accent-light' : 'text-warm-muted hover:text-warm-text'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[15px]">table_rows</span>
                            </button>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => toggleTableCompact(index)}
                              className={`p-1 rounded-lg transition-colors active:scale-90 ${
                                block.is_compact ? 'text-warm-accent bg-warm-accent-light' : 'text-warm-muted hover:text-warm-text'
                              }`}
                            >
                              <span className="material-symbols-outlined text-[15px] leading-none">view_compact</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center bg-[#FAF8F5] border border-cream-divider rounded-lg p-0.5 shrink-0">
                          <span className="text-[10px] font-semibold text-warm-accent pl-1 pr-0.5 uppercase tracking-wider flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[13px] leading-none rotate-90">table_rows</span>
                          </span>
                          <button
                            type="button"
                            title={t('add_col')}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addTableColumn(index)}
                            className="w-5 h-5 flex items-center justify-center rounded text-warm-muted hover:text-warm-accent active:scale-90 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[13px] leading-none">add</span>
                          </button>
                          <button
                            type="button"
                            title={t('del_col')}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => removeTableColumn(index, activeTableCell?.colIndex)}
                            disabled={(block.cells[0]?.length || 0) <= 1}
                            className="w-5 h-5 flex items-center justify-center rounded text-warm-muted hover:text-red-600 disabled:opacity-20 active:scale-90 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[13px] leading-none">remove</span>
                          </button>
                        </div>
                      </div>

                      <div className="w-full max-w-full overflow-x-auto no-scrollbar scroll-smooth overscroll-x-contain">
                        <table
                          className={`text-xs border-collapse ${
                            (block.cells[0]?.length || 0) <= 2 ? 'w-full table-fixed' : 'w-max min-w-full'
                          }`}
                        >
                          <tbody>
                            {block.cells.map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className={`${
                                  rIdx === 0
                                    ? `bg-cream-surface/80 font-semibold text-warm-text`
                                    : block.is_striped && rIdx % 2 === 1
                                    ? 'bg-cream-surface/35'
                                    : 'bg-transparent'
                                }`}
                              >
                                {row.map((col, cIdx) => (
                                  <td
                                    key={cIdx}
                                    style={{ outline: 'none' }}
                                    className={`p-0 relative min-w-0 outline-none ${
                                      (block.cells[0]?.length || 0) > 2 ? 'min-w-[100px]' : ''
                                    } ${
                                      block.is_bordered
                                        ? 'border border-cream-divider'
                                        : 'border border-transparent'
                                    }`}
                                  >
                                    <EditableBlock
                                      html={col.text}
                                      placeholder={rIdx === 0 ? `${t('table_col')} ${cIdx + 1}` : `${t('table_row')} ${rIdx + 1}`}
                                      onFocus={() => {
                                        setFocusedBlockIndex(index);
                                        setActiveTableCell({ blockIndex: index, rowIndex: rIdx, colIndex: cIdx });
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                        }
                                      }}
                                      onChange={(newHtml) => {
                                        const nextCells = block.cells.map((r, ri) =>
                                          r.map((c, ci) => (ri === rIdx && ci === cIdx ? { ...c, text: newHtml } : c))
                                        );
                                        updateBlock(index, { ...block, cells: nextCells }, false);
                                      }}
                                      className={`w-full min-w-0 bg-transparent border-none outline-none focus:outline-none focus:ring-0 text-warm-text font-medium transition-all min-h-[22px] ${
                                        block.is_compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1.5 text-xs'
                                      } ${
                                        col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                                      }`}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div
                        className={`flex items-center px-2.5 py-1.5 bg-cream-surface/40 ${
                          block.is_bordered ? 'border-t border-cream-divider' : ''
                        }`}
                      >
                        <div className="flex items-center bg-[#FAF8F5] border border-cream-divider rounded-lg p-0.5">
                          <span className="text-[10px] font-semibold text-warm-accent pl-1 pr-0.5 uppercase tracking-wider flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[13px] leading-none">table_rows</span>
                          </span>
                          <button
                            type="button"
                            title={t('add_row')}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addTableRow(index)}
                            className="w-5 h-5 flex items-center justify-center rounded text-warm-muted hover:text-warm-accent active:scale-90 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[13px] leading-none">add</span>
                          </button>
                          <button
                            type="button"
                            title={t('del_row')}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => removeTableRow(index, activeTableCell?.rowIndex)}
                            disabled={block.cells.length <= 1}
                            className="w-5 h-5 flex items-center justify-center rounded text-warm-muted hover:text-red-600 disabled:opacity-20 active:scale-90 transition-transform"
                          >
                            <span className="material-symbols-outlined text-[13px] leading-none">remove</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {block.type === 'code' && (
                  <div className="bg-cream-surface/70 rounded-xl p-2.5 my-1.5 font-code border border-cream-divider/60 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between border-b border-cream-divider/40 pb-1">
                      <span className="text-[10px] font-mono font-semibold uppercase text-warm-accent">Code Block</span>
                      <input
                        type="text"
                        value={block.language || ''}
                        placeholder="lang (e.g. python, js, html)"
                        onFocus={() => setFocusedBlockIndex(index)}
                        onChange={(e) => updateBlock(index, { ...block, language: e.target.value.toLowerCase().trim() })}
                        className="text-[10px] font-mono text-warm-muted bg-transparent border-none focus:outline-none text-right placeholder:text-warm-subtle w-32"
                      />
                    </div>
                    <textarea
                      rows={1}
                      value={block.text}
                      placeholder={t('code_placeholder')}
                      ref={(el) => {
                        if (el) autoResize(el);
                      }}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onInput={(e) => autoResize(e.currentTarget)}
                      onChange={(e) => updateBlock(index, { ...block, text: e.target.value })}
                      className="w-full bg-transparent border-none focus:outline-none text-xs text-warm-text font-code resize-none overflow-hidden"
                    />
                  </div>
                )}

                {block.type === 'math' && (
                  <div className="flex items-center gap-1 py-1 font-code text-xs text-warm-accent">
                    <span>$$</span>
                    <input
                      type="text"
                      value={block.expression}
                      placeholder={t('math_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(e) => updateBlock(index, { ...block, expression: e.target.value })}
                      className="w-full bg-transparent border-none focus:outline-none text-warm-text font-code"
                    />
                    <span>$$</span>
                  </div>
                )}

                {block.type === 'details' && (
                  <div className="w-full my-2 rounded-xl border border-cream-divider/80 bg-cream-surface/40 overflow-hidden transition-all duration-200">
                    <div
                      onClick={() => toggleDetails(block.id)}
                      className="flex items-center justify-between px-3 py-2 bg-cream-surface/60 cursor-pointer select-none gap-2"
                    >
                      <div onClick={(e) => e.stopPropagation()} className="flex-1 min-w-0 pr-1">
                        <EditableBlock
                          html={block.summary}
                          placeholder={t('details_summary_placeholder')}
                          onFocus={() => setFocusedBlockIndex(index)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                            }
                          }}
                          onChange={(newHtml) => updateBlock(index, { ...block, summary: newHtml })}
                          className="w-full text-xs font-semibold text-warm-text bg-transparent border-none focus:outline-none min-h-[18px]"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerHaptic('light');
                            updateBlock(index, { ...block, is_open: !block.is_open }, true);
                          }}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all duration-200 active:scale-95 ${
                            block.is_open
                              ? 'bg-warm-accent text-white shadow-xs'
                              : 'bg-[#FAF8F5] text-warm-muted border border-cream-divider/80 hover:text-warm-text'
                          }`}
                        >
                          <span className={`material-symbols-outlined text-[13px] leading-none transition-transform duration-200 ${block.is_open ? 'rotate-180' : 'rotate-0'}`}>
                            {block.is_open ? 'unfold_more' : 'unfold_less'}
                          </span>
                          <span>{block.is_open ? t('details_auto_open') : t('details_collapsed')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDetails(block.id);
                          }}
                          className="w-6 h-6 flex items-center justify-center text-warm-muted hover:text-warm-text transition-transform duration-200 shrink-0"
                          style={{
                            transform: openDetailsMap[block.id] !== false ? 'rotate(180deg)' : 'rotate(0deg)',
                          }}
                        >
                          <span className="material-symbols-outlined text-[16px]">expand_more</span>
                        </button>
                      </div>
                    </div>
                    <div
                      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                        openDetailsMap[block.id] !== false
                          ? 'grid-rows-[1fr] opacity-100'
                          : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="p-3 border-t border-cream-divider/60">
                          <EditableBlock
                            html={block.text}
                            placeholder={t('details_content_placeholder')}
                            onFocus={() => setFocusedBlockIndex(index)}
                            onChange={(newHtml) => updateBlock(index, { ...block, text: newHtml })}
                            className="w-full text-xs leading-relaxed text-warm-text bg-transparent border-none focus:outline-none min-h-[22px]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {block.type === 'divider' && (
                  <div
                    tabIndex={0}
                    onClick={() => {
                      triggerHaptic('light');
                      setFocusedBlockIndex(index);
                    }}
                    onFocus={() => setFocusedBlockIndex(index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        e.preventDefault();
                        removeBlock(index);
                      }
                    }}
                    className="w-full py-3 cursor-pointer group/divider flex items-center focus:outline-none"
                  >
                    <div
                      className={`w-full h-[1.5px] transition-all duration-150 ${
                        focusedBlockIndex === index
                          ? 'bg-warm-accent shadow-xs'
                          : 'bg-cream-divider group-hover/divider:bg-warm-subtle'
                      }`}
                    />
                  </div>
                )}
                {block.type === 'footer' && (
                  <div className="w-full my-2 flex flex-col gap-1 transition-all pt-1">
                    <div className="flex items-center justify-between pb-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-warm-subtle flex items-center gap-1">
                        <span className="material-symbols-outlined text-[13px]">short_text</span>
                        <span>{t('tool_footer')}</span>
                      </span>
                    </div>
                    <EditableBlock
                      html={block.text}
                      placeholder={t('footer_placeholder')}
                      onFocus={() => setFocusedBlockIndex(index)}
                      onChange={(newHtml) => updateBlock(index, { ...block, text: newHtml })}
                      className="w-full text-xs font-normal text-warm-muted leading-relaxed bg-transparent border-none focus:outline-none min-h-[20px]"
                    />
                  </div>
                )}
                {block.type === 'button_row' && (
                  <div
                    onClick={() => setFocusedBlockIndex(index)}
                    className="flex flex-col gap-1.5 my-2 w-full min-w-0 transition-all select-none"
                  >
                    <div
                      className={`flex items-center justify-between gap-2 overflow-hidden transition-all duration-200 ease-out ${
                        focusedBlockIndex === index
                          ? 'max-h-10 opacity-100 py-1'
                          : 'max-h-0 opacity-0 pointer-events-none py-0'
                      }`}
                    >
                      <div className="flex items-center bg-cream-surface border border-cream-divider rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleButtonRowFullWidth(index);
                          }}
                          title={t('btn_fit_message')}
                          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                            block.full_width ? 'text-warm-accent bg-[#FAF8F5] shadow-xs' : 'text-warm-muted hover:text-warm-text'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">fit_screen</span>
                        </button>
                        <div className="w-[1px] h-3.5 bg-cream-divider mx-0.5" />
                        <button
                          type="button"
                          disabled={block.full_width}
                          onClick={(e) => {
                            e.stopPropagation();
                            setButtonRowAlign(index, 'left');
                          }}
                          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                            !block.full_width && block.align === 'left' ? 'text-warm-accent bg-[#FAF8F5] shadow-xs' : 'text-warm-muted hover:text-warm-text disabled:opacity-30'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">format_align_left</span>
                        </button>
                        <button
                          type="button"
                          disabled={block.full_width}
                          onClick={(e) => {
                            e.stopPropagation();
                            setButtonRowAlign(index, 'center');
                          }}
                          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                            !block.full_width && (!block.align || block.align === 'center') ? 'text-warm-accent bg-[#FAF8F5] shadow-xs' : 'text-warm-muted hover:text-warm-text disabled:opacity-30'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">format_align_center</span>
                        </button>
                        <button
                          type="button"
                          disabled={block.full_width}
                          onClick={(e) => {
                            e.stopPropagation();
                            setButtonRowAlign(index, 'right');
                          }}
                          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                            !block.full_width && block.align === 'right' ? 'text-warm-accent bg-[#FAF8F5] shadow-xs' : 'text-warm-muted hover:text-warm-text disabled:opacity-30'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">format_align_right</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addButtonToRow(index);
                        }}
                        disabled={block.buttons.length >= 3}
                        className="px-2.5 py-1 rounded-full bg-cream-surface border border-cream-divider text-[11px] font-semibold text-warm-accent disabled:opacity-30 flex items-center gap-1 active:scale-95 transition-transform"
                      >
                        <span className="material-symbols-outlined text-[13px]">add</span>
                        <span>{t('btn_add_to_row')}</span>
                      </button>
                    </div>
                    <div
                      className={`flex items-center gap-2 py-2 w-full ${
                        block.align === 'right'
                          ? 'justify-end'
                          : block.align === 'left'
                          ? 'justify-start'
                          : 'justify-center'
                      }`}
                    >
                      {block.buttons.map((btn, btnIdx) => {
                        const styleClass =
                          btn.style === 'primary'
                            ? 'bg-[#2AABEE] text-white border-transparent'
                            : btn.style === 'success'
                            ? 'bg-[#3E7356] text-white border-transparent'
                            : btn.style === 'danger'
                            ? 'bg-[#BA4A38] text-white border-transparent'
                            : 'bg-[#FAF8F5] text-warm-text border-cream-divider';

                        const isThisDragging = activeDraggingBtnId === btn.id;
                        const isRowJiggling = activeJiggleRowIndex === index;

                        const jiggleClass =
                          isRowJiggling && !isThisDragging
                            ? btnIdx % 2 === 0
                              ? 'animate-jiggle-a'
                              : 'animate-jiggle-b'
                            : '';

                        const dynamicTransform = isThisDragging
                          ? `translate3d(${dragOffsetX}px, -2px, 0) scale(1.04)`
                          : 'translate3d(0, 0, 0) scale(1)';

                        const widthClass = block.full_width
                          ? 'flex-1 min-w-0 max-w-full px-3'
                          : 'flex-initial min-w-0 max-w-[85%] px-4';

                        return (
                          <button
                            key={btn.id}
                            type="button"
                            onTouchStart={(e) => handleBtnTouchStart(index, btnIdx, btn.id, e)}
                            onTouchMove={(e) => handleBtnTouchMove(index, e)}
                            onTouchEnd={handleBtnTouchEnd}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!buttonDragRef.current?.isDragging) {
                                handleOpenButtonConfig(index, btnIdx, btn);
                              }
                            }}
                            style={{
                              transform: dynamicTransform,
                              transition: isThisDragging
                                ? 'none'
                                : 'transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1), flex 0.38s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.38s cubic-bezier(0.4, 0, 0.2, 1), padding 0.38s cubic-bezier(0.4, 0, 0.2, 1)',
                              willChange: isThisDragging ? 'transform' : 'transform, flex, max-width',
                            }}
                            className={`py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border cursor-pointer touch-none select-none relative ${widthClass} ${styleClass} ${jiggleClass} ${
                              isThisDragging
                                ? 'z-30 border-warm-accent ring-1 ring-warm-accent'
                                : 'active:opacity-80'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px] leading-none opacity-85 shrink-0 pointer-events-none">
                              {btn.type === 'copy_text' ? 'content_copy' : 'link'}
                            </span>
                            <span className="truncate block min-w-0 pointer-events-none">{btn.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                  </div>

              {(focusedBlockIndex === index || block.type === 'button_row') && (
                <div className="absolute right-0 -top-3 z-10 flex items-center gap-1 bg-[#FAF8F5] border border-cream-divider/80 px-1.5 py-0.5 rounded-full shadow-sm animate-page-fade">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => moveBlock(index, 'up')}
                    disabled={index === 0}
                    className="w-5 h-5 flex items-center justify-center text-warm-muted hover:text-warm-text disabled:opacity-25 physics-bounce"
                  >
                    <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => moveBlock(index, 'down')}
                    disabled={index === currentNote.blocks.length - 1}
                    className="w-5 h-5 flex items-center justify-center text-warm-muted hover:text-warm-text disabled:opacity-25 physics-bounce"
                  >
                    <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => removeBlock(index)}
                    className="w-5 h-5 flex items-center justify-center text-warm-muted hover:text-red-600 physics-bounce"
                  >
                    <span className="material-symbols-outlined text-[13px]">delete</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      

      {isEditorActive && !showExportModal && !editingButtonModal && !timePickerModal.isOpen && !linkModal.isOpen &&
        createPortal(
          <div
            data-format-bar="true"
            className="fixed inset-x-0 z-50 flex justify-center px-3 pointer-events-none max-w-[420px] mx-auto select-none"
            style={{
              bottom: keyboardInset > 0
                ? `${keyboardInset + 10}px`
                : 'calc(max(var(--tg-content-bottom, 0px), var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 12px)',
            }}
          >
            <div className="pointer-events-auto flex items-center p-1 rounded-full bg-[#F5F1EB] border border-cream-divider shadow-md max-w-full overflow-hidden">
              <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-0.5">
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => applyFormatCommand('bold')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors text-xs font-bold shrink-0 ${
                      activeFormats.bold
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    B
                  </button>
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => applyFormatCommand('italic')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors text-xs italic font-serif shrink-0 ${
                      activeFormats.italic
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    I
                  </button>
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => applyFormatCommand('underline')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors text-xs underline shrink-0 ${
                      activeFormats.underline
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    U
                  </button>
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => applyFormatCommand('strikeThrough')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors text-xs line-through shrink-0 ${
                      activeFormats.strike
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    S
                  </button>
                </div>

                <div className="w-[1px] h-3.5 bg-cream-divider mx-0.5 shrink-0" />

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => toggleCustomTag('mark')}
                    title={t('tool_mark')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors shrink-0 ${
                      activeFormats.mark
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">
                      border_color
                    </span>
                  </button>
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => toggleCustomTag('code')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors text-[11px] font-mono shrink-0 ${
                      activeFormats.code
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    &lt;/&gt;
                  </button>
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => toggleCustomTag('tg-spoiler')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors shrink-0 ${
                      activeFormats.spoiler
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      visibility_off
                    </span>
                  </button>
                </div>

                <div className="w-[1px] h-3.5 bg-cream-divider mx-0.5 shrink-0" />

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={openLinkModal}
                    title={t('tool_link')}
                    className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors shrink-0 ${
                      activeFormats.link
                        ? 'bg-warm-accent text-[#FAF8F5]'
                        : 'text-warm-muted hover:text-warm-text active:bg-cream-divider'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">
                      link
                    </span>
                  </button>
                  <button
                    onPointerDown={(e) => {
                      e.preventDefault();
                      openTimePicker();
                    }}
                    className="flex items-center justify-center w-7 h-7 rounded-full transition-colors text-warm-muted hover:text-warm-text active:bg-cream-divider shrink-0"
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">
                      schedule
                    </span>
                  </button>
                </div>

                <div className="w-[1px] h-3.5 bg-cream-divider mx-0.5 shrink-0" />

                <div className="flex items-center shrink-0">
                  <button
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={handleClearFormatting}
                    className="flex items-center justify-center w-7 h-7 rounded-full transition-colors text-warm-muted hover:text-warm-text active:bg-cream-divider shrink-0"
                  >
                    <span className="material-symbols-outlined text-[15px] leading-none">
                      format_clear
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {linkModal.isOpen &&
        createPortal(
          <div
            data-modal="true"
            onClick={() => setLinkModal((prev) => ({ ...prev, isOpen: false }))}
            className="fixed inset-0 z-50 flex justify-center bg-[#FAF8F5] animate-sheet-up"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] h-full flex flex-col bg-[#FAF8F5]"
            >
              <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
                <span className="text-sm font-semibold tracking-wide text-warm-text">
                  {t('link_modal_title')}
                </span>
                <button
                  type="button"
                  onClick={() => setLinkModal((prev) => ({ ...prev, isOpen: false }))}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-warm-muted hover:bg-cream-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-2 flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                    {t('link_url_label')}
                  </label>
                  <input
                    type="text"
                    value={linkModal.url}
                    placeholder={t('link_url_placeholder')}
                    onChange={(e) =>
                      setLinkModal((prev) => ({ ...prev, url: e.target.value }))
                    }
                    className="w-full bg-transparent border-b border-cream-divider px-1 py-2.5 text-sm text-warm-text focus:outline-none focus:border-warm-accent transition-colors font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                    {t('link_text_label')}
                  </label>
                  <input
                    type="text"
                    value={linkModal.text}
                    placeholder={t('link_text_label')}
                    onChange={(e) =>
                      setLinkModal((prev) => ({ ...prev, text: e.target.value }))
                    }
                    className="w-full bg-transparent border-b border-cream-divider px-1 py-2.5 text-sm text-warm-text focus:outline-none focus:border-warm-accent transition-colors"
                  />
                </div>
                {headingsList.length > 0 && (
                  <div className="flex flex-col gap-3 pt-4">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                      {t('link_headings_hint')}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {headingsList.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => {
                            triggerHaptic('light');
                            setLinkModal((prev) => ({
                              ...prev,
                              url: `#chapter-${h.id}`,
                              text: prev.text || h.text,
                            }));
                          }}
                          className={`text-[11px] px-3.5 py-1.5 rounded-full border transition-all ${
                            linkModal.url === `#chapter-${h.id}`
                              ? 'bg-warm-text border-warm-text text-[#FAF8F5] font-medium'
                              : 'bg-transparent border-cream-divider text-warm-muted hover:text-warm-text'
                          }`}
                        >
                          {h.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div 
                className="px-6 py-4 flex items-center justify-between gap-3 shrink-0"
                style={{
                  paddingBottom: keyboardInset > 0
                    ? `${keyboardInset + 16}px`
                    : 'calc(max(var(--tg-content-bottom, 0px), var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 16px)',
                }}
              >
                {linkModal.isEditing ? (
                  <button
                    type="button"
                    onClick={removeLink}
                    className="px-5 py-2.5 rounded-full text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 active:scale-95 transition-all"
                  >
                    {t('link_remove')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLinkModal((prev) => ({ ...prev, isOpen: false }))}
                    className="px-5 py-2.5 rounded-full text-xs font-semibold text-warm-muted hover:text-warm-text active:scale-95 transition-all"
                  >
                    {t('deselect_all')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={applyLink}
                  disabled={!linkModal.url.trim()}
                  className="flex-1 max-w-[200px] py-2.5 rounded-full text-sm font-semibold text-[#FAF8F5] bg-warm-accent active:scale-95 transition-all disabled:opacity-30"
                >
                  {t('link_apply')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showExportModal &&
        createPortal(
          <div
            onClick={() => {
              if (!isExporting) setShowExportModal(false);
            }}
            className="fixed inset-0 z-50 flex justify-center bg-[#FAF8F5] animate-sheet-up"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] h-full flex flex-col bg-[#FAF8F5]"
            >
              <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
                <span className="text-sm font-semibold tracking-wide text-warm-text">
                  {t('export_modal_title')}
                </span>
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => setShowExportModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-warm-muted hover:bg-cream-surface transition-colors disabled:opacity-30"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-2 flex flex-col">
                <label className="flex items-center justify-between py-4 border-b border-cream-divider/50 cursor-pointer select-none group">
                  <div className="flex items-center gap-3.5">
                    <span className="material-symbols-outlined text-[20px] text-warm-accent">send</span>
                    <span className="text-sm text-warm-text font-medium">{t('export_private_chat')}</span>
                  </div>
                  <input
                    type="checkbox"
                    disabled={isExporting}
                    checked={sendToUserChat}
                    onChange={(e) => setSendToUserChat(e.target.checked)}
                    className="w-5 h-5 accent-warm-accent rounded border-cream-divider"
                  />
                </label>

                <div className="pt-6 pb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                    {t('export_select_channels')}
                  </span>
                </div>
                
                {(!channels || channels.length === 0) ? (
                  <div className="py-4 text-[11px] text-warm-subtle italic">
                    {t('no_channels_hint')}
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {channels.map((ch) => {
                      const isChecked = selectedExportChannels.includes(ch.id);
                      return (
                        <label
                          key={ch.id}
                          className="flex items-center justify-between py-3.5 border-b border-cream-divider/50 cursor-pointer select-none group"
                        >
                          <div className="flex items-center gap-3.5 min-w-0 pr-4">
                            <span className={`material-symbols-outlined text-[18px] transition-colors ${isChecked ? 'text-warm-text' : 'text-warm-muted group-hover:text-warm-text'}`}>tag</span>
                            <span className={`text-sm truncate transition-colors ${isChecked ? 'font-medium text-warm-text' : 'text-warm-muted group-hover:text-warm-text'}`}>{ch.title}</span>
                          </div>
                          <input
                            type="checkbox"
                            disabled={isExporting}
                            checked={isChecked}
                            onChange={() => toggleChannelSelection(ch.id)}
                            className="w-5 h-5 accent-warm-accent rounded border-cream-divider shrink-0"
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div 
                className="px-6 py-4 flex items-center justify-end gap-3 shrink-0"
                style={{
                  paddingBottom: 'calc(max(var(--tg-content-bottom, 0px), var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 16px)',
                }}
              >
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => setShowExportModal(false)}
                  className="px-5 py-2.5 rounded-full text-xs font-semibold text-warm-muted hover:text-warm-text active:scale-95 transition-transform disabled:opacity-30"
                >
                  {t('deselect_all')}
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={isExporting || (!sendToUserChat && selectedExportChannels.length === 0)}
                  className="px-6 py-2.5 rounded-full text-sm font-semibold text-[#FAF8F5] bg-warm-text active:scale-95 transition-all disabled:opacity-30 flex items-center gap-2"
                >
                  {isExporting ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-[2px] border-white/20 border-t-white animate-spin" />
                      <span>{t('exporting')}</span>
                    </>
                  ) : (
                    <span>{selectedExportChannels.length > 0 ? t('export_with_ad') : t('export_rich')}</span>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {editingButtonModal &&
        createPortal(
          <div
            data-modal="true"
            onClick={() => setEditingButtonModal(null)}
            className="fixed inset-0 z-50 flex justify-center bg-[#FAF8F5] animate-sheet-up"
          >
            <div
              data-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] h-full flex flex-col bg-[#FAF8F5]"
            >
              <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
                <span className="text-sm font-semibold tracking-wide text-warm-text">
                  {t('btn_edit_title')}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingButtonModal(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-warm-muted hover:bg-cream-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-2 flex flex-col gap-6">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                    {t('btn_text_label')}
                  </label>
                  <input
                    type="text"
                    value={editingButtonModal.text}
                    placeholder={t('btn_text_placeholder')}
                    onChange={(e) =>
                      setEditingButtonModal({ ...editingButtonModal, text: e.target.value })
                    }
                    className="w-full bg-transparent border-b border-cream-divider px-1 py-2.5 text-sm text-warm-text focus:outline-none focus:border-warm-accent transition-colors"
                  />
                </div>
                
                <div className="flex flex-col gap-4">
                  <div className="flex items-center bg-cream-surface/60 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingButtonModal({ ...editingButtonModal, type: 'url' })
                      }
                      className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        editingButtonModal.type === 'url'
                          ? 'bg-[#FAF8F5] text-warm-text shadow-sm'
                          : 'text-warm-muted hover:text-warm-text'
                      }`}
                    >
                      {t('btn_type_url')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingButtonModal({ ...editingButtonModal, type: 'copy_text' })
                      }
                      className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        editingButtonModal.type === 'copy_text'
                          ? 'bg-[#FAF8F5] text-warm-text shadow-sm'
                          : 'text-warm-muted hover:text-warm-text'
                      }`}
                    >
                      {t('btn_type_copy')}
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                      {editingButtonModal.type === 'url' ? 'URL Link' : 'Copy Value'}
                    </label>
                    <input
                      type="text"
                      value={editingButtonModal.value}
                      placeholder={
                        editingButtonModal.type === 'url'
                          ? t('btn_url_placeholder')
                          : t('btn_copy_placeholder')
                      }
                      onChange={(e) =>
                        setEditingButtonModal({ ...editingButtonModal, value: e.target.value })
                      }
                      className="w-full bg-transparent border-b border-cream-divider px-1 py-2.5 text-sm text-warm-text focus:outline-none focus:border-warm-accent transition-colors font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 pt-2">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">Theme</label>
                  <div className="flex flex-wrap gap-3">
                    {(['default', 'primary', 'success', 'danger'] as const).map((clr) => {
                      const isActive = editingButtonModal.style === clr;
                      const label = t(`btn_style_${clr}` as any);
                      const bgClass =
                        clr === 'primary'
                          ? 'bg-[#2AABEE]'
                          : clr === 'success'
                          ? 'bg-[#3E7356]'
                          : clr === 'danger'
                          ? 'bg-[#BA4A38]'
                          : 'bg-[#EAE4DC]';
                      return (
                        <button
                          key={clr}
                          type="button"
                          onClick={() =>
                            setEditingButtonModal({ ...editingButtonModal, style: clr })
                          }
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${
                            isActive ? 'border-warm-text bg-cream-surface' : 'border-cream-divider bg-transparent opacity-70 hover:opacity-100'
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded-full ${bgClass} shrink-0`} />
                          <span className={`text-[11px] font-medium ${isActive ? 'text-warm-text' : 'text-warm-muted'}`}>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div 
                className="px-6 py-4 flex items-center justify-between gap-3 shrink-0"
                style={{
                  paddingBottom: 'calc(max(var(--tg-content-bottom, 0px), var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 16px)',
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    deleteButtonFromRow(
                      editingButtonModal.blockIndex,
                      editingButtonModal.buttonIndex
                    )
                  }
                  className="px-5 py-2.5 rounded-full text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 active:scale-95 transition-transform"
                >
                  {t('btn_delete')}
                </button>
                <button
                  type="button"
                  onClick={saveEditedButton}
                  className="flex-1 max-w-[200px] py-2.5 rounded-full text-sm font-semibold text-[#FAF8F5] bg-warm-accent active:scale-95 transition-transform"
                >
                  {t('btn_save')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {timePickerModal.isOpen &&
        createPortal(
          <div
            data-modal="true"
            onClick={() => setTimePickerModal((prev) => ({ ...prev, isOpen: false }))}
            className="fixed inset-0 z-50 flex justify-center bg-[#FAF8F5] animate-sheet-up"
          >
            <div
              data-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] h-full flex flex-col bg-[#FAF8F5]"
            >
              <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
                <span className="text-sm font-semibold tracking-wide text-warm-text">
                  {t('time_modal_title')}
                </span>
                <button
                  type="button"
                  onClick={() => setTimePickerModal((prev) => ({ ...prev, isOpen: false }))}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-warm-muted hover:bg-cream-surface transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-2 flex flex-col gap-8">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                    {t('time_label_datetime')}
                  </label>
                  <input
                    type="datetime-local"
                    value={timePickerModal.datetimeVal}
                    onChange={(e) =>
                      setTimePickerModal((prev) => ({ ...prev, datetimeVal: e.target.value }))
                    }
                    className="w-full bg-transparent border-b border-cream-divider px-1 py-2.5 text-base text-warm-text focus:outline-none focus:border-warm-accent transition-colors font-mono"
                  />
                </div>
                
                <div className="flex flex-col gap-3">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-warm-subtle">
                    {t('time_label_format')}
                  </label>
                  <div className="flex flex-col">
                    {[
                      { id: 'wDT', labelKey: 'time_format_wdt' },
                      { id: 'full', labelKey: 'time_format_full' },
                      { id: 'time', labelKey: 'time_format_time_only' },
                      { id: 'rel', labelKey: 'time_format_rel' },
                    ].map((fmt) => {
                      const isSelected = timePickerModal.format === fmt.id;
                      return (
                        <button
                          key={fmt.id}
                          type="button"
                          onClick={() =>
                            setTimePickerModal((prev) => ({ ...prev, format: fmt.id as any }))
                          }
                          className="flex items-center justify-between py-3.5 border-b border-cream-divider/50 group"
                        >
                          <span className={`text-sm transition-colors ${isSelected ? 'font-medium text-warm-text' : 'text-warm-muted group-hover:text-warm-text'}`}>
                            {t(fmt.labelKey as any)}
                          </span>
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isSelected ? 'border-warm-accent bg-warm-accent' : 'border-warm-subtle bg-transparent'}`}>
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#FAF8F5]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div 
                className="px-6 py-4 flex items-center justify-end gap-3 shrink-0"
                style={{
                  paddingBottom: 'calc(max(var(--tg-content-bottom, 0px), var(--tg-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)) + 16px)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setTimePickerModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-5 py-2.5 rounded-full text-xs font-semibold text-warm-muted hover:text-warm-text active:scale-95 transition-all"
                >
                  {t('deselect_all')}
                </button>
                <button
                  type="button"
                  onClick={insertDynamicTime}
                  className="px-6 py-2.5 rounded-full text-sm font-semibold text-[#FAF8F5] bg-warm-text active:scale-95 transition-transform"
                >
                  {t('time_insert')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {botPromptModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#24201D]/40 animate-page-fade">
          <div className="w-full max-w-sm p-5 rounded-2xl bg-[#FAF8F5] border border-cream-divider shadow-sm flex flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-warm-accent-light text-warm-accent flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[18px]">mark_chat_unread</span>
              </div>
              <h3 className="text-sm font-semibold text-warm-text">
                {t('bot_modal_title')}
              </h3>
            </div>
            <p className="text-xs leading-relaxed text-warm-muted">
              {t('bot_modal_desc')}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1.5">
              <button
                onClick={() => setBotPromptModal({ isOpen: false, botUsername: '' })}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-warm-muted bg-cream-surface physics-bounce"
              >
                {t('bot_modal_later')}
              </button>
              <button
                onClick={() => {
                  const botLink = botPromptModal.botUsername
                    ? `https://t.me/${botPromptModal.botUsername}?start=export`
                    : 'https://t.me';
                  if (window.Telegram?.WebApp?.openTelegramLink) {
                    window.Telegram.WebApp.openTelegramLink(botLink);
                  } else {
                    window.open(botLink, '_blank');
                  }
                  setBotPromptModal({ isOpen: false, botUsername: '' });
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-warm-accent flex items-center gap-1.5 physics-bounce"
              >
                <span>{t('bot_modal_open')}</span>
                <span className="material-symbols-outlined text-[13px]">open_in_new</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};