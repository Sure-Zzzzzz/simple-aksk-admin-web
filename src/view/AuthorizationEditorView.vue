<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AkskPageHeader from '../components/AkskPageHeader.vue';
import Dialog from '@sure-zzzzzz/simple-iam-theme-contract/Dialog';
import {
  ConflictError,
  createAkskApplicationAuthorization,
  getAkskApplicationAuthorization,
  replaceAkskApplicationAuthorization,
  revokeAkskApplicationAuthorization,
  type AkskApplicationAuthorization,
  type AkskApplicationAuthorizationInput,
  type AkskDataConstraint,
  type AkskDataGrant,
  type AkskDataGrantDocument
} from '../api/akskAuth';

const route = useRoute();
const router = useRouter();
const clientId = route.params.clientId as string;

interface ConstraintDraft {
  dimension: string;
  valuesText: string;
}

interface GrantDraft {
  resource: string;
  actionsText: string;
  all: boolean;
  constraints: ConstraintDraft[];
}

const mode = ref<'edit' | 'create'>('edit');
const authorization = ref<AkskApplicationAuthorization | null>(null);
const notFoundClient = ref(false);
const loading = ref(false);
const message = ref('');
const errorMessage = ref('');
const savePending = ref(false);
const conflictOpen = ref(false);
const revokeConfirmOpen = ref(false);
const revokePending = ref(false);

const form = reactive({
  applicationCode: '',
  admitted: false,
  roles: '',
  pagePermissions: '',
  apiPermissions: '',
  manifestVersion: '',
  manifestDigest: ''
});

const docForm = reactive({
  protocol: '',
  version: '',
  grants: [] as GrantDraft[]
});

const jsonOpen = ref(false);
const jsonText = ref('');
const jsonError = ref('');

const editing = computed(() => mode.value === 'edit' && !!authorization.value && !authorization.value.revokedAt);

function splitTokens(value: string): string[] {
  return value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function grantDraftFrom(grant: AkskDataGrant): GrantDraft {
  return {
    resource: grant.resource,
    actionsText: grant.actions.join(' '),
    all: grant.all,
    constraints: grant.constraints.map(constraint => ({
      dimension: constraint.dimension,
      valuesText: constraint.values.join(', ')
    }))
  };
}

function fillForm(detail: AkskApplicationAuthorization) {
  form.applicationCode = detail.applicationCode;
  form.admitted = detail.admitted;
  form.roles = detail.roles.join('\n');
  form.pagePermissions = detail.pagePermissions.join('\n');
  form.apiPermissions = detail.apiPermissions.join('\n');
  form.manifestVersion = detail.manifestVersion;
  form.manifestDigest = detail.manifestDigest;
  docForm.protocol = detail.dataGrantDocument?.protocol ?? '';
  docForm.version = detail.dataGrantDocument?.version ?? '';
  docForm.grants = (detail.dataGrantDocument?.grants ?? []).map(grantDraftFrom);
}

async function loadAuthorization() {
  loading.value = true;
  errorMessage.value = '';
  try {
    authorization.value = await getAkskApplicationAuthorization(clientId);
    mode.value = 'edit';
    notFoundClient.value = false;
    fillForm(authorization.value);
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      mode.value = 'create';
      notFoundClient.value = true;
    } else {
      errorMessage.value = error instanceof Error ? error.message : '加载应用授权失败';
    }
  } finally {
    loading.value = false;
  }
}

function addGrant() {
  docForm.grants.push({ resource: '', actionsText: '', all: false, constraints: [] });
}

function removeGrant(index: number) {
  docForm.grants.splice(index, 1);
}

function addConstraint(grant: GrantDraft) {
  grant.constraints.push({ dimension: '', valuesText: '' });
}

function removeConstraint(grant: GrantDraft, index: number) {
  grant.constraints.splice(index, 1);
}

function toggleGrantAll(grant: GrantDraft) {
  grant.all = !grant.all;
  if (grant.all) {
    grant.constraints = [];
  }
}

function buildGrantDocument(): AkskDataGrantDocument | null | { error: string } {
  if (!docForm.grants.length) {
    return null;
  }
  if (!docForm.protocol.trim() || !docForm.version.trim()) {
    return { error: '存在授权条目时，数据授权文档的 protocol 与 version 均必填' };
  }
  const grants: AkskDataGrant[] = [];
  for (const grant of docForm.grants) {
    if (!grant.resource.trim()) {
      return { error: '授权条目的 resource 不能为空' };
    }
    const actions = splitTokens(grant.actionsText);
    if (!actions.length) {
      return { error: `条目 ${grant.resource} 的 actions 不能为空` };
    }
    const constraints: AkskDataConstraint[] = [];
    if (!grant.all) {
      for (const constraint of grant.constraints) {
        if (!constraint.dimension.trim()) {
          return { error: `条目 ${grant.resource} 存在空的约束维度` };
        }
        const values = constraint.valuesText.split(/[,，]/).map(item => item.trim()).filter(Boolean);
        if (!values.length) {
          return { error: `条目 ${grant.resource} 的约束 ${constraint.dimension} 缺少取值` };
        }
        constraints.push({ dimension: constraint.dimension.trim(), operator: 'IN', values });
      }
    }
    grants.push({
      resource: grant.resource.trim(),
      actions,
      all: grant.all,
      constraints: grant.all ? [] : constraints
    });
  }
  return { protocol: docForm.protocol.trim(), version: docForm.version.trim(), grants };
}

function buildInput(): AkskApplicationAuthorizationInput | null {
  if (!form.applicationCode.trim()) {
    errorMessage.value = '请填写应用编码';
    return null;
  }
  if (!form.manifestVersion.trim() || !form.manifestDigest.trim()) {
    errorMessage.value = '清单版本与清单摘要是必填项（来自应用权限清单登记）';
    return null;
  }
  const document = buildGrantDocument();
  if (document && 'error' in document) {
    errorMessage.value = document.error;
    return null;
  }
  return {
    applicationCode: form.applicationCode.trim(),
    admitted: form.admitted,
    roles: splitLines(form.roles),
    pagePermissions: splitLines(form.pagePermissions),
    apiPermissions: splitLines(form.apiPermissions),
    dataGrantDocument: document,
    manifestVersion: form.manifestVersion.trim(),
    manifestDigest: form.manifestDigest.trim()
  };
}

async function submitSave() {
  message.value = '';
  errorMessage.value = '';
  const input = buildInput();
  if (!input) {
    return;
  }
  savePending.value = true;
  try {
    if (mode.value === 'create') {
      await createAkskApplicationAuthorization(clientId, input);
      message.value = '应用授权已创建';
    } else {
      await replaceAkskApplicationAuthorization(clientId, input);
      message.value = '应用授权已保存（整单替换，活跃令牌已撤销）';
    }
    await loadAuthorization();
  } catch (error) {
    if (error instanceof ConflictError) {
      if (mode.value === 'create') {
        errorMessage.value = '该客户端已存在应用授权，请刷新列表后从编辑入口进入';
      } else {
        conflictOpen.value = true;
      }
    } else {
      errorMessage.value = error instanceof Error ? error.message : '保存应用授权失败';
    }
  } finally {
    savePending.value = false;
  }
}

async function confirmConflictReload() {
  conflictOpen.value = false;
  await loadAuthorization();
}

async function confirmRevoke() {
  revokePending.value = true;
  try {
    await revokeAkskApplicationAuthorization(clientId);
    revokeConfirmOpen.value = false;
    message.value = '应用授权已撤销';
    await loadAuthorization();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '撤销应用授权失败';
    revokeConfirmOpen.value = false;
  } finally {
    revokePending.value = false;
  }
}

function documentPreview(): string {
  const document = buildGrantDocument();
  if (document && 'error' in document) {
    return `（当前内容尚无法生成文档：${document.error}）`;
  }
  return JSON.stringify(document, null, 2);
}

function toggleJsonPanel() {
  jsonOpen.value = !jsonOpen.value;
  jsonError.value = '';
  if (jsonOpen.value) {
    jsonText.value = documentPreview();
  }
}

function parseGrantDocument(text: string): { ok: true; document: AkskDataGrantDocument } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '文档必须是 JSON 对象' };
  }
  const record = parsed as Record<string, unknown>;
  const documentKeys = ['protocol', 'version', 'grants'];
  const extraKeys = Object.keys(record).filter(key => !documentKeys.includes(key));
  if (extraKeys.length) {
    return { ok: false, error: `文档存在多余字段：${extraKeys.join(', ')}（字段需精确匹配）` };
  }
  if (typeof record.protocol !== 'string' || !record.protocol.trim()
    || typeof record.version !== 'string' || !record.version.trim()
    || !Array.isArray(record.grants)) {
    return { ok: false, error: 'protocol、version、grants 均必填（grants 为数组）' };
  }
  const grants: AkskDataGrant[] = [];
  const grantKeys = ['resource', 'actions', 'all', 'constraints'];
  const constraintKeys = ['dimension', 'operator', 'values'];
  for (const [index, rawGrant] of record.grants.entries()) {
    if (!rawGrant || typeof rawGrant !== 'object' || Array.isArray(rawGrant)) {
      return { ok: false, error: `第 ${index + 1} 条 grant 不是对象` };
    }
    const grantRecord = rawGrant as Record<string, unknown>;
    const grantExtra = Object.keys(grantRecord).filter(key => !grantKeys.includes(key));
    if (grantExtra.length) {
      return { ok: false, error: `第 ${index + 1} 条 grant 存在多余字段：${grantExtra.join(', ')}` };
    }
    if (typeof grantRecord.resource !== 'string' || !grantRecord.resource.trim()
      || !Array.isArray(grantRecord.actions) || !grantRecord.actions.length
      || grantRecord.actions.some(action => typeof action !== 'string' || !action.trim())
      || typeof grantRecord.all !== 'boolean'
      || !Array.isArray(grantRecord.constraints)) {
      return { ok: false, error: `第 ${index + 1} 条 grant 字段不完整（resource/actions/all/constraints 均必填）` };
    }
    if (grantRecord.all && grantRecord.constraints.length) {
      return { ok: false, error: `第 ${index + 1} 条 grant：all=true 时 constraints 必须为空数组` };
    }
    const constraints: AkskDataConstraint[] = [];
    for (const rawConstraint of grantRecord.constraints) {
      if (!rawConstraint || typeof rawConstraint !== 'object' || Array.isArray(rawConstraint)) {
        return { ok: false, error: `第 ${index + 1} 条 grant 存在非对象的约束` };
      }
      const constraintRecord = rawConstraint as Record<string, unknown>;
      const constraintExtra = Object.keys(constraintRecord).filter(key => !constraintKeys.includes(key));
      if (constraintExtra.length) {
        return { ok: false, error: `约束存在多余字段：${constraintExtra.join(', ')}` };
      }
      if (typeof constraintRecord.dimension !== 'string' || !constraintRecord.dimension.trim()
        || constraintRecord.operator !== 'IN'
        || !Array.isArray(constraintRecord.values) || !constraintRecord.values.length
        || constraintRecord.values.some(value => typeof value !== 'string' || !value.trim())) {
        return { ok: false, error: '约束需为 {dimension, operator: "IN", values} 且取值非空' };
      }
      constraints.push({
        dimension: constraintRecord.dimension,
        operator: 'IN',
        values: constraintRecord.values as string[]
      });
    }
    grants.push({
      resource: grantRecord.resource as string,
      actions: grantRecord.actions as string[],
      all: grantRecord.all as boolean,
      constraints
    });
  }
  return { ok: true, document: { protocol: record.protocol as string, version: record.version as string, grants } };
}

function applyJsonImport() {
  const result = parseGrantDocument(jsonText.value);
  if (!result.ok) {
    jsonError.value = result.error;
    return;
  }
  docForm.protocol = result.document.protocol;
  docForm.version = result.document.version;
  docForm.grants = result.document.grants.map(grantDraftFrom);
  jsonError.value = '';
  message.value = '已导入数据授权文档';
}

onMounted(() => {
  void loadAuthorization();
});
</script>

<template>
  <section class="management-page">
    <AkskPageHeader
      :title="mode === 'create' ? `配置应用授权：${clientId}` : `应用授权：${clientId}`"
      :description="editing ? '整单替换保存：成功后该客户端全部活跃令牌会被撤销，新令牌按新授权签发快照。' : '该客户端尚未配置授权：填写后创建。'"
    >
      <template #actions>
        <button class="button-secondary" type="button" @click="router.push('/authorizations')">返回列表</button>
        <button v-if="editing" class="button-danger" type="button" @click="revokeConfirmOpen = true">撤销授权</button>
        <button class="button-primary" type="button" :disabled="savePending || loading" @click="submitSave">
          {{ savePending ? '正在保存…' : mode === 'create' ? '创建授权' : '保存（整单替换）' }}
        </button>
      </template>
    </AkskPageHeader>
    <p v-if="message" class="admin-message success" role="status">{{ message }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="message = ''">×</button></p>
    <p v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button></p>
    <p v-if="loading" class="admin-message" role="status">正在加载授权…</p>

    <section v-if="authorization" class="admin-data-surface">
      <div class="data-toolbar">
        <div>
          <h2>当前状态</h2>
          <p>服务端版本号单调递增，请求不携带版本；并发修改会在保存时以冲突提示。</p>
        </div>
      </div>
      <div class="detail-maintenance">
        <p class="drawer-status-line">
          <span v-if="authorization.revokedAt" class="status-badge danger">已撤销 · {{ formatDateTime(authorization.revokedAt) }}</span>
          <span v-else class="status-badge" :class="authorization.enabled ? 'success' : 'neutral'">{{ authorization.enabled ? '生效中' : '已停用' }}</span>
          <span class="status-badge" :class="authorization.admitted ? 'success' : 'warning'">{{ authorization.admitted ? '已准入' : '草稿（不签发快照）' }}</span>
          <span>版本 v{{ authorization.authorizationVersion }}</span>
          <span>更新于 {{ formatDateTime(authorization.updatedAt) }}</span>
        </p>
      </div>
    </section>

    <section class="admin-data-surface">
      <div class="data-toolbar">
        <div>
          <h2>授权内容</h2>
          <p>应用编码创建后不可变更；未勾选准入时保存为草稿，不向令牌签发权限快照。</p>
        </div>
      </div>
      <form class="detail-maintenance" @submit.prevent="submitSave">
        <div class="inline-form-row">
          <label>
            <span>应用编码{{ mode === 'edit' ? '（不可变更）' : '' }}</span>
            <input v-model="form.applicationCode" :readonly="mode === 'edit'" required placeholder="如 aksk">
          </label>
          <label>
            <span>清单版本（必填）</span>
            <input v-model="form.manifestVersion" required placeholder="如 v1">
          </label>
          <label>
            <span>清单摘要（必填）</span>
            <input v-model="form.manifestDigest" required placeholder="来自应用权限清单登记">
          </label>
        </div>
        <label class="checkbox-field">
          <input v-model="form.admitted" type="checkbox">
          <span>准入：允许向该客户端签发的令牌携带授权快照（不勾选=草稿）</span>
        </label>
        <div class="inline-form-row">
          <label>
            <span>角色编码（每行一个）</span>
            <textarea v-model="form.roles" rows="4" placeholder="app-admin&#10;app-user"></textarea>
          </label>
          <label>
            <span>页面权限编码（每行一个）</span>
            <textarea v-model="form.pagePermissions" rows="4" placeholder="app:order:page"></textarea>
          </label>
          <label>
            <span>API 权限编码（每行一个）</span>
            <textarea v-model="form.apiPermissions" rows="4" placeholder="app:order:api"></textarea>
          </label>
        </div>

        <div class="rule-grant-list">
          <div class="section-title-row">
            <h3 class="drawer-section-title">数据授权文档（可选）</h3>
            <button class="button-secondary" type="button" @click="addGrant">+ 添加授权条目</button>
          </div>
          <p class="drawer-hint">条目之间为「或」关系，条目内动作与约束为「且」关系；勾选全量后不能再配约束。留空表示无数据授权。</p>
          <div v-if="docForm.grants.length" class="rule-grant-list">
            <div v-for="(grant, grantIndex) in docForm.grants" :key="grantIndex" class="rule-grant-card">
              <div class="rule-grant-header">
                <label>
                  <span class="sr-only">资源</span>
                  <input v-model="grant.resource" placeholder="资源（如 kms:key）">
                </label>
                <button class="button-secondary" type="button" @click="removeGrant(grantIndex)">移除条目</button>
              </div>
              <label>
                <span>actions（空格或逗号分隔）</span>
                <input v-model="grant.actionsText" placeholder="read write">
              </label>
              <label class="checkbox-field">
                <input type="checkbox" :checked="grant.all" @change="toggleGrantAll(grant)">
                <span>全量授权（all=true，勾选后约束清空且不可配置）</span>
              </label>
              <template v-if="!grant.all">
                <div v-for="(constraint, constraintIndex) in grant.constraints" :key="constraintIndex" class="rule-constraint-row">
                  <label>
                    <span class="sr-only">约束维度</span>
                    <input v-model="constraint.dimension" placeholder="维度（如 department）">
                  </label>
                  <label>
                    <span class="sr-only">取值（逗号分隔，IN）</span>
                    <input v-model="constraint.valuesText" placeholder="取值，逗号分隔（IN）">
                  </label>
                  <button class="button-secondary" type="button" @click="removeConstraint(grant, constraintIndex)">移除</button>
                </div>
                <button class="button-secondary ghost" type="button" @click="addConstraint(grant)">+ 添加约束（IN）</button>
              </template>
            </div>
          </div>
          <div v-if="docForm.grants.length" class="inline-form-row doc-meta-row">
            <label>
              <span>文档 protocol（必填）</span>
              <input v-model="docForm.protocol" placeholder="如 urn:aksk:data-grant:1">
            </label>
            <label>
              <span>文档 version（必填）</span>
              <input v-model="docForm.version" placeholder="如 1">
            </label>
          </div>

          <div class="preview-block">
            <div class="section-title-row">
              <p class="preview-block-title">JSON 预览 / 粘贴导入</p>
              <button class="button-secondary" type="button" @click="toggleJsonPanel">{{ jsonOpen ? '收起' : '展开' }}</button>
            </div>
            <div v-if="jsonOpen" class="rule-grant-list">
              <textarea v-model="jsonText" rows="8" placeholder="{&quot;protocol&quot;:&quot;...&quot;,&quot;version&quot;:&quot;...&quot;,&quot;grants&quot;:[...]}" aria-label="数据授权文档 JSON"></textarea>
              <p v-if="jsonError" class="admin-message error" role="alert">{{ jsonError }}</p>
              <div class="admin-page-actions">
                <button class="button-secondary" type="button" @click="jsonText = documentPreview()">重新生成预览</button>
                <button class="button-primary" type="button" @click="applyJsonImport">校验并导入</button>
              </div>
            </div>
            <pre v-else class="grant-document-readonly">{{ documentPreview() }}</pre>
          </div>
        </div>
      </form>
    </section>

    <Dialog
      :open="conflictOpen"
      title="授权已被并发修改"
      description="其他会话已保存了该授权的更新版本。点击确认将重新拉取最新内容回填表单，请人工比对后再次提交。"
      confirm-label="重拉并重新编辑"
      variant="confirm"
      @close="conflictOpen = false"
      @confirm="confirmConflictReload"
    />

    <Dialog
      :open="revokeConfirmOpen"
      title="撤销应用授权"
      :description="`撤销后 ${clientId} 不再向新令牌签发授权快照，该客户端全部活跃令牌一并失效。确定撤销？`"
      confirm-label="确认撤销"
      :pending="revokePending"
      @close="!revokePending && (revokeConfirmOpen = false)"
      @confirm="confirmRevoke"
    />
  </section>
</template>
