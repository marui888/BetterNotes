import { create } from 'zustand'

export const useVideoStore = create((set) => ({
  videoFile: null,
  notes: [],
  selectedNoteId: null,
  curStart: '',
  curEnd: '',
  noteDraft: '',
  selectedStart: '',
  selectedEnd: '',
  playingTime: '00:00:00.0',
  playbackRate: 1,
  repeat: false,
  directoryMp4Files: [],
  recentVideoFiles: [],

  setVideoFile: (videoFile) => set({ videoFile }),
  setNotes: (notes) => set({ notes }),
  setSelectedNoteId: (selectedNoteId) => set({ selectedNoteId }),
  setCurStart: (curStart) => set({ curStart }),
  setCurEnd: (curEnd) => set({ curEnd }),
  setNoteDraft: (noteDraft) => set({ noteDraft }),
  setSelectedStart: (selectedStart) => set({ selectedStart }),
  setSelectedEnd: (selectedEnd) => set({ selectedEnd }),
  setPlayingTime: (playingTime) => set({ playingTime }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setRepeat: (repeat) => set({ repeat }),
  setDirectoryMp4Files: (directoryMp4Files) => set({ directoryMp4Files }),
  addRecentVideoFile: (filePath) =>
    set((state) => ({
      recentVideoFiles: [
        filePath,
        ...state.recentVideoFiles.filter((item) => item !== filePath),
      ].slice(0, 20),
    })),
  addNote: (note) =>
    set((state) => ({
      notes: [...state.notes, note],
      selectedNoteId: note.id,
      noteDraft: note.content,
      selectedStart: note.start,
      selectedEnd: note.end,
    })),
  insertNoteAt: (index, note) =>
    set((state) => {
      const nextNotes = [...state.notes]
      const insertIndex = Math.max(0, Math.min(index, nextNotes.length))
      nextNotes.splice(insertIndex, 0, note)

      return {
        notes: nextNotes,
        selectedNoteId: note.id,
        noteDraft: note.content,
        selectedStart: note.start,
        selectedEnd: note.end,
      }
    }),
  updateNote: (noteId, patch) =>
    set((state) => ({
      notes: state.notes.map((note) => (
        note.id === noteId ? { ...note, ...patch } : note
      )),
    })),
  deleteNote: (noteId) =>
    set((state) => {
      const index = state.notes.findIndex((note) => note.id === noteId)
      const notes = state.notes.filter((note) => note.id !== noteId)
      const nextNote = notes[Math.min(index, notes.length - 1)] || null

      return {
        notes,
        selectedNoteId: nextNote?.id || null,
        noteDraft: nextNote?.content || '',
        selectedStart: nextNote?.start || '',
        selectedEnd: nextNote?.end || '',
      }
    }),
  clearNotes: () => set({
    notes: [],
    selectedNoteId: null,
    noteDraft: '',
    selectedStart: '',
    selectedEnd: '',
  }),
}))
