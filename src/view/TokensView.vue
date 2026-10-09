<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AkskPageHeader from '../components/AkskPageHeader.vue';
import CopyButton from '../components/CopyButton.vue';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import FormSelect, { type FormSelectOption } from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import {
  deleteAkskExpiredTokens,
  deleteAkskToken,
  getAkskTokenStatistics,
  listAkskRedisTokens,
  listAkskTokens,
  revokeAkskToken,
  revokeAkskTokensByClientId,
  type AkskTokenInfo,
  type AkskTokenStatistics
} from '../api/akskAuth';

const router = useRouter();

const tokenColumns: DataTableColumn[] = [
  { key: 'id', label: '令牌 ID' },
  { key: 'clientId', label: '客户端' },
  { key: 'clientTypeLabel', label: '类型' },
  { key: 'owner', label: '归属' },
  { key: 'status', label: '状态' },
  { key: 'dataSource', label: '数据源' },
  { key: 'expiry', label: '签发 / 过期' },
  { key: 'actions', label: '操作', align: 'right' },
];

const source = ref<'mysql' | 'redis'>('mysql');
const tokens = ref<AkskTokenInfo[]>([]);
const statistics = ref<AkskTokenStatistics | null>(null);
const loading = ref(false);
const message = ref('');
const errorMessage = ref('');
const rowPendingId = ref('');

const filterForm = reactive({
  clientId: '',
  clientType: '' as '' | '1' | '2',
  status: '' as '' | 'ACTIVE' | 'EXPIRED' | 'REVOKED',
  search: ''
});

const clientTypeFilterOptions: FormSelectOption[] = [
  { label: '全部类型', value: '' },
  { label: 'AKP 平台级', value: '1' },
  { label: 'AKU 用户级', value: '2' }
];
const tokenStatusFilterOptions: FormSelectOption[] = [
  { label: '全部状态', value: '' },
  { label: '有效', value: 'ACTIVE' },
  { label: '已过期', value: 'EXPIRED' },
  { label: '已撤销', value: 'REVOKED' }
];

const pageSize = ref(10);
const currentPage = ref(1);
const totalPages = ref(1);
const totalElements = ref(0);

const revokeByClientPending = ref(false);
const revokeByClientConfirmOpen = ref(false);
const clearExpiredPending = ref(false);

const isMysql = computed(() => source.value === 'mysql');

const metricCards = computed(() => {
  const stats = statistics.value;
  if (!stats) {
    return [];
  }
  return [
    { label: '令牌总数', value: stats.totalCount },
    { label: '有效', value: stats.activeCount },
    { label: '已撤销', value: stats.revokedCount },
    { label: '已过期', value: stats.expiredCount },
    { label: 'MySQL 源', value: stats.mysqlCount },
    { label: 'Redis 源', value: stats.redisCount },
    { label: '双源共存', value: stats.bothCount }
  ];
});

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function statusLabel(status: AkskTokenInfo['status']): string {
  return status === 'ACTIVE' ? '有效' : status === 'EXPIRED' ? '已过期' : '已撤销';
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value) {
    return;
  }
  currentPage.value = page;
  void loadTokens();
}

function changePageSize(size: number) {
  if (size < 1 || size === pageSize.value) {
    return;
  }
  pageSize.value = size;
  currentPage.value = 1;
  void loadTokens();
}

function searchTokens() {
  currentPage.value = 1;
  void loadTokens();
}

function switchSource(next: 'mysql' | 'redis') {
  if (source.value === next) {
    return;
  }
  source.value = next;
  currentPage.value = 1;
  void loadTokens();
}

async function loadStatistics() {
  try {
    statistics.value = await getAkskTokenStatistics();
  } catch {
    statistics.value = null;
  }
}

async function loadTokens() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const page = isMysql.value
      ? await listAkskTokens({
          ...(filterForm.clientId.trim() ? { clientId: filterForm.clientId.trim() } : {}),
          ...(filterForm.clientType ? { clientType: Number(filterForm.clientType) as 1 | 2 } : {}),
          ...(filterForm.status ? { status: filterForm.status } : {}),
          ...(filterForm.search.trim() ? { search: filterForm.search.trim() } : {}),
          page: currentPage.value,
          size: pageSize.value
        })
      : await listAkskRedisTokens({
          ...(filterForm.status ? { status: filterForm.status } : {}),
          page: currentPage.value,
          size: pageSize.value
        });
    tokens.value = page.data;
    totalElements.value = page.total;
    totalPages.value = Math.max(page.totalPages, 1);
    currentPage.value = page.page;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载令牌列表失败';
  } finally {
    loading.value = false;
  }
}

async function submitRevoke(token: AkskTokenInfo) {
  message.value = '';
  errorMessage.value = '';
  rowPendingId.value = token.id;
  try {
    await revokeAkskToken(token.id);
    message.value = '令牌已撤销';
    await Promise.all([loadTokens(), loadStatistics()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '撤销令牌失败';
  } finally {
    rowPendingId.value = '';
  }
}

async function submitDelete(token: AkskTokenInfo) {
  message.value = '';
  errorMessage.value = '';
  rowPendingId.value = token.id;
  try {
    await deleteAkskToken(token.id);
    message.value = '令牌已删除';
    await Promise.all([loadTokens(), loadStatistics()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '删除令牌失败';
  } finally {
    rowPendingId.value = '';
  }
}

async function confirmRevokeByClient() {
  const clientId = filterForm.clientId.trim();
  if (!clientId) {
    return;
  }
  revokeByClientPending.value = true;
  try {
    const result = await revokeAkskTokensByClientId(clientId);
    revokeByClientConfirmOpen.value = false;
    message.value = `已撤销客户端 ${clientId} 名下 ${result.revokedCount} 个令牌`;
    await Promise.all([loadTokens(), loadStatistics()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '批量撤销失败';
    revokeByClientConfirmOpen.value = false;
  } finally {
    revokeByClientPending.value = false;
  }
}

async function submitClearExpired() {
  message.value = '';
  errorMessage.value = '';
  clearExpiredPending.value = true;
  try {
    const result = await deleteAkskExpiredTokens();
    message.value = `已清理 ${result.deletedCount} 个过期令牌`;
    await Promise.all([loadTokens(), loadStatistics()]);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清理过期令牌失败';
  } finally {
    clearExpiredPending.value = false;
  }
}

onMounted(() => {
  void loadStatistics();
  void loadTokens();
});
</script>

<template>
  <section class="management-page">
    <AkskPageHeader
      title="令牌"
      description="查询与治理 AKSK 令牌：多源存储状态、撤销、删除与过期清理。令牌值不向管理面暴露。"
    />
    <p v-if="message" class="admin-message success" role="status">{{ message }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="message = ''">×</button></p>
    <p v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button></p>

    <div v-if="metricCards.length" class="metric-cards">
      <div v-for="card in metricCards" :key="card.label" class="metric-card">
        <span class="metric-label">{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
      </div>
    </div>

    <section class="admin-data-surface">
      <div class="data-toolbar">
        <div>
          <h2>令牌列表 <span>{{ totalElements }}</span></h2>
          <p>{{ isMysql ? 'MySQL 源支持全部筛选；Redis 源仅支持状态筛选。' : 'Redis 源令牌仅支持状态筛选与分页。' }}</p>
        </div>
        <div class="admin-page-actions">
          <button class="button-secondary" type="button" :disabled="clearExpiredPending" @click="submitClearExpired">
            {{ clearExpiredPending ? '正在清理…' : '清理过期令牌' }}
          </button>
        </div>
      </div>
      <div class="type-filter-tabs" role="tablist" aria-label="数据源选择">
        <button type="button" :class="{ active: isMysql }" @click="switchSource('mysql')">MySQL 源</button>
        <button type="button" :class="{ active: !isMysql }" @click="switchSource('redis')">Redis 源</button>
      </div>
      <div class="data-toolbar filter-bar">
        <div class="search-field">
          <label class="sr-only" for="token-client-filter">客户端 ID</label>
          <input
            id="token-client-filter"
            v-model="filterForm.clientId"
            type="search"
            :disabled="!isMysql"
            placeholder="按客户端 ID 筛选"
            @keyup.enter="searchTokens"
          >
        </div>
        <div class="search-field">
          <label class="sr-only" for="token-search">搜索</label>
          <input
            id="token-search"
            v-model="filterForm.search"
            type="search"
            :disabled="!isMysql"
            placeholder="搜索客户端名称 / 归属"
            @keyup.enter="searchTokens"
          >
        </div>
        <FormSelect
          v-model="filterForm.clientType"
          :options="clientTypeFilterOptions"
          :disabled="!isMysql"
          aria-label="客户端类型"
          @change="searchTokens"
        />
        <FormSelect
          v-model="filterForm.status"
          :options="tokenStatusFilterOptions"
          aria-label="状态"
          @change="searchTokens"
        />
        <div class="admin-page-actions">
          <button v-if="isMysql && filterForm.clientId.trim()" class="button-danger" type="button" @click="revokeByClientConfirmOpen = true">
            撤销该客户端全部令牌
          </button>
          <button class="button-primary" type="button" :disabled="loading" @click="searchTokens">查询</button>
        </div>
      </div>
      <DataTable
        :columns="tokenColumns"
        :rows="tokens"
        row-key="id"
        :loading="loading"
        empty-text="暂无符合条件的令牌。"
      >
        <template #cell-id="{ row }">
          <div class="client-cell">
            <span class="cell-ellipsis token-id" :title="row.id">{{ row.id }}</span>
            <CopyButton :value="row.id" label="ID" ghost />
          </div>
        </template>
        <template #cell-clientId="{ row }">
          <div class="client-cell">
            <button
              class="table-primary-action"
              type="button"
              @click="router.push(`/clients/${encodeURIComponent(row.clientId)}`)"
            >
              <strong>{{ row.clientName || row.clientId }}</strong>
              <span>{{ row.clientId }}</span>
            </button>
            <CopyButton :value="row.clientId" label="AK" ghost />
          </div>
        </template>
        <template #cell-clientTypeLabel="{ row }">{{ row.clientType === 1 ? 'AKP' : 'AKU' }}</template>
        <template #cell-owner="{ row }">{{ row.ownerUsername || row.ownerUserId || '—' }}</template>
        <template #cell-status="{ row }">
          <span class="status-badge" :class="row.status === 'ACTIVE' ? 'success' : row.status === 'REVOKED' ? 'danger' : 'neutral'">
            {{ statusLabel(row.status) }}
          </span>
        </template>
        <template #cell-dataSource="{ row }"><span class="status-badge neutral">{{ row.dataSource }}</span></template>
        <template #cell-expiry="{ row }">{{ formatDateTime(row.issuedAt) }} / {{ formatDateTime(row.expiresAt) }}</template>
        <template #cell-actions="{ row }">
          <div class="table-actions-inline">
            <button
              v-if="row.status === 'ACTIVE'"
              class="table-action"
              type="button"
              :disabled="rowPendingId === row.id"
              @click="submitRevoke(row)"
            >
              撤销
            </button>
            <button
              class="table-action danger"
              type="button"
              :disabled="rowPendingId === row.id"
              @click="submitDelete(row)"
            >
              删除
            </button>
          </div>
        </template>
      </DataTable>
      <Pagination
        v-if="totalElements > 0"
        :current="currentPage"
        :total="totalElements"
        :page-size="pageSize"
        @update:current="changePage"
        @update:page-size="changePageSize"
      />
    </section>

    <Dialog
      :open="revokeByClientConfirmOpen"
      title="批量撤销令牌"
      :description="`将撤销客户端 ${filterForm.clientId.trim()} 名下全部有效令牌，依赖这些令牌的调用会立即失败。确定撤销？`"
      confirm-label="确认撤销"
      :pending="revokeByClientPending"
      @close="!revokeByClientPending && (revokeByClientConfirmOpen = false)"
      @confirm="confirmRevokeByClient"
    />
  </section>
</template>
