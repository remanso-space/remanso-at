<script setup lang="ts">
import { ref, watch } from "vue"

import { useSession } from "../composables/useSession"

const { handle, avatarUrl, prefillHandle, isLoggedIn, isReady, signIn, signOut } = useSession()

const inputHandle = ref("")

// A remanso.space cross-link may set the prefill after this component mounts.
watch(
  prefillHandle,
  (value) => {
    if (value) inputHandle.value = value
  },
  { immediate: true },
)

const onSignIn = () => {
  const value = inputHandle.value.trim()
  if (value) signIn(value)
}
</script>

<template>
  <div class="signin">
    <span v-if="!isReady" class="signin-wait mono">…</span>

    <div v-else-if="isLoggedIn" class="signin-me">
      <img v-if="avatarUrl" :src="avatarUrl" alt="" class="signin-avatar" width="24" height="24" />
      <span class="signin-handle mono">{{ handle }}</span>
      <button type="button" class="signin-out" @click="signOut">Sign out</button>
    </div>

    <div v-else class="signin-form">
      <input
        v-model="inputHandle"
        class="signin-input mono"
        type="text"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        placeholder="alice.bsky.social"
        @keyup.enter="onSignIn"
      />
      <button type="button" class="signin-go" @click="onSignIn">Sign in</button>
    </div>
  </div>
</template>

<style scoped>
.signin {
  display: flex;
  align-items: center;
}

.signin-wait {
  color: var(--hw-ink-faint);
  font-size: 0.9rem;
}

.signin-me {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.signin-avatar {
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.signin-handle {
  font-size: 0.85rem;
  color: var(--hw-ink-soft);
  max-width: 16ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.signin-out {
  font-family: var(--hw-serif);
  font-size: 0.85rem;
  color: var(--hw-ink-faint);
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
}

.signin-out:hover {
  color: var(--hw-pink-deep);
}

.signin-form {
  display: flex;
  align-items: stretch;
  gap: 0;
}

.signin-input {
  font-size: 0.85rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--hw-rule);
  border-right: 0;
  border-radius: 2px 0 0 2px;
  background: var(--hw-paper);
  color: var(--hw-ink);
  width: 12rem;
  max-width: 40vw;
}

.signin-input:focus {
  outline: none;
  border-color: var(--hw-pink-deep);
}

.signin-go {
  font-family: var(--hw-serif);
  font-weight: 600;
  font-size: 0.85rem;
  padding: 0.3rem 0.8rem;
  border: 1px solid var(--hw-ink);
  border-radius: 0 2px 2px 0;
  background: var(--hw-ink);
  color: var(--hw-paper);
  cursor: pointer;
  white-space: nowrap;
}

.signin-go:hover {
  background: var(--hw-pink-deep);
  border-color: var(--hw-pink-deep);
}
</style>
