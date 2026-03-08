/**
 * Composable for case comment state management
 *
 * Provides reactive comment state per case with IPC-backed persistence.
 * Used by CaseCommentsTab for comment CRUD.
 */

import { ref } from 'vue'
import type { CaseComment, CommentCategory } from '../../../shared/types/api'

// Cache comments by caseId
const commentsCache = ref<Map<number, CaseComment[]>>(new Map())
const loadingStates = ref<Map<number, boolean>>(new Map())

export const COMMENT_CATEGORIES: CommentCategory[] = [
  'Clinical Note',
  'Lab Result',
  'Interpretation',
  'Follow-up',
  'Family History',
  'Treatment'
]

export const COMMENT_CATEGORY_ICONS: Record<CommentCategory, string> = {
  'Clinical Note': 'mdi-stethoscope',
  'Lab Result': 'mdi-flask',
  Interpretation: 'mdi-lightbulb-outline',
  'Follow-up': 'mdi-calendar-check',
  'Family History': 'mdi-family-tree',
  Treatment: 'mdi-pill'
}

export const COMMENT_CATEGORY_COLORS: Record<CommentCategory, string> = {
  'Clinical Note': 'primary',
  'Lab Result': 'info',
  Interpretation: 'warning',
  'Follow-up': 'success',
  'Family History': 'purple',
  Treatment: 'teal'
}

export function useCaseComments() {
  async function loadComments(caseId: number): Promise<void> {
    if (loadingStates.value.get(caseId) === true) return

    loadingStates.value.set(caseId, true)
    try {
      const comments = await window.api.caseComments.list(caseId)
      commentsCache.value.set(caseId, comments)
    } catch (error) {
      console.error('Failed to load comments:', error)
    } finally {
      loadingStates.value.set(caseId, false)
    }
  }

  function getComments(caseId: number): CaseComment[] {
    return commentsCache.value.get(caseId) ?? []
  }

  function isLoading(caseId: number): boolean {
    return loadingStates.value.get(caseId) ?? false
  }

  async function createComment(
    caseId: number,
    category: CommentCategory,
    content: string
  ): Promise<CaseComment> {
    const comment = await window.api.caseComments.create(caseId, category, content)

    // Add to cache (newest first)
    const cached = commentsCache.value.get(caseId) ?? []
    cached.unshift(comment)
    commentsCache.value.set(caseId, cached)

    return comment
  }

  async function updateComment(caseId: number, commentId: number, content: string): Promise<void> {
    const updated = await window.api.caseComments.update(commentId, content)

    // Update in cache
    const cached = commentsCache.value.get(caseId)
    if (cached) {
      const index = cached.findIndex((c) => c.id === commentId)
      if (index !== -1) {
        cached[index] = updated
      }
    }
  }

  async function deleteComment(caseId: number, commentId: number): Promise<void> {
    await window.api.caseComments.delete(commentId)

    // Remove from cache
    const cached = commentsCache.value.get(caseId)
    if (cached) {
      commentsCache.value.set(
        caseId,
        cached.filter((c) => c.id !== commentId)
      )
    }
  }

  function clearCache(): void {
    commentsCache.value.clear()
    loadingStates.value.clear()
  }

  return {
    loadComments,
    getComments,
    isLoading,
    createComment,
    updateComment,
    deleteComment,
    clearCache
  }
}
