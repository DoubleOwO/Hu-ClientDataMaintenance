<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useVuelidate } from '@vuelidate/core'
import { required, helpers } from '@vuelidate/validators'
import { db } from './firebase.js'
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  deleteDoc,
  updateDoc,
  query,
  where,
  getDocs,
  writeBatch,
  Timestamp,
} from 'firebase/firestore'

// Reactive State
const clients = ref([])
const maintenanceRecords = ref([])
const searchQuery = ref('')
const sortKey = ref('createdAt')
const sortOrder = ref('desc')

// Loading State
const areClientsLoaded = ref(false)
const areRecordsLoaded = ref(false)

// Pagination State
const currentPage = ref(1)
const pageSize = ref(30)
const pageSizes = [30, 50, 100]

// Form State
const showForm = ref(false)
const newClient = ref({ name: '', phone: '', licensePlate: '', vin: '', memo: '' })
const editingClient = ref(null)

// Modal State
const viewingClientRecords = ref(null)
const showAddRecordForm = ref(false)
const newRecord = ref({ date: new Date().toISOString().split('T')[0], item: '', price: 0 })
const editingRecord = ref(null)

// --- Validation ---
const phoneFormat = helpers.regex(/^09\d{8}$/)
const rules = computed(() => ({
  name: { required: helpers.withMessage('姓名為必填欄位', required) },
  phone: { phoneFormat: helpers.withMessage('請輸入有效的10位手機號碼', phoneFormat) },
}))
const v$ = useVuelidate(rules, newClient)

// --- Firestore Data Synchronization ---
onMounted(() => {
  const clientsQuery = query(collection(db, 'clients'))
  onSnapshot(clientsQuery, (querySnapshot) => {
    clients.value = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    areClientsLoaded.value = true
  })

  const recordsQuery = query(collection(db, 'maintenanceRecords'))
  onSnapshot(recordsQuery, (querySnapshot) => {
    maintenanceRecords.value = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    areRecordsLoaded.value = true
  })
})

// --- Computed Properties ---
const isLoading = computed(() => !areClientsLoaded.value || !areRecordsLoaded.value)

const filteredClients = computed(() => {
  let filtered = [...clients.value]
  if (searchQuery.value) {
    const lowerCaseQuery = searchQuery.value.toLowerCase()
    filtered = filtered.filter(
      (client) =>
        client.name?.toLowerCase().includes(lowerCaseQuery) ||
        client.phone?.toLowerCase().includes(lowerCaseQuery) ||
        client.licensePlate?.toLowerCase().includes(lowerCaseQuery) ||
        client.vin?.toLowerCase().includes(lowerCaseQuery),
    )
  }
  if (sortKey.value) {
    filtered.sort((a, b) => {
      const order = sortOrder.value === 'asc' ? 1 : -1
      let valA = a[sortKey.value]
      let valB = b[sortKey.value]
      if (valA === undefined || valA === null) return 1
      if (valB === undefined || valB === null) return -1
      if (sortKey.value === 'createdAt' && valA instanceof Timestamp && valB instanceof Timestamp) {
        return (valA.seconds - valB.seconds) * order
      }
      return String(valA).localeCompare(String(valB), 'zh-Hant') * order
    })
  }
  return filtered
})

const totalPages = computed(() => {
  return Math.ceil(filteredClients.value.length / pageSize.value)
})

const paginatedClients = computed(() => {
  const startIndex = (currentPage.value - 1) * pageSize.value
  const endIndex = startIndex + pageSize.value
  return filteredClients.value.slice(startIndex, endIndex)
})

const allRecordsForViewingClient = computed(() => {
  if (!viewingClientRecords.value) return []
  return maintenanceRecords.value
    .filter((r) => r.vin === viewingClientRecords.value.vin)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
})

function getLatestRecords(vin) {
  return maintenanceRecords.value
    .filter((r) => r.vin === vin)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 3)
}

// --- Watchers ---
watch([searchQuery, pageSize], () => {
  currentPage.value = 1
})

// --- Helper Functions ---
function formatTimestamp(ts) {
  if (!ts || !ts.seconds) return 'N/A'
  return new Date(ts.seconds * 1000).toLocaleString('zh-TW')
}

function truncateText(text, length = 15) {
  if (!text) return ''
  if (text.length <= length) return text
  return text.slice(0, length) + '...'
}

// --- Sort & Pagination Functions ---
function sortBy(key) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = 'asc'
  }
}

function goToPage(page) {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
  }
}

// --- Modal and Form Functions ---
function openAddClientForm() {
  newClient.value = { name: '', phone: '', licensePlate: '', vin: '', memo: '' } // Reset form
  v$.value.$reset() // Reset validation state
  showForm.value = true
}

function showAllRecords(client) {
  viewingClientRecords.value = client
}
function closeRecordModal() {
  viewingClientRecords.value = null
  showAddRecordForm.value = false
  editingRecord.value = null
}
function startEdit(client) {
  editingClient.value = { ...client }
  showForm.value = false
}
function cancelEdit() {
  editingClient.value = null
}
function startEditRecord(record) {
  editingRecord.value = { ...record }
}
function cancelEditRecord() {
  editingRecord.value = null
}

// --- CRUD Functions ---
async function addClient() {
  const isValid = await v$.value.$validate()
  if (!isValid) return

  const clientToAdd = { ...newClient.value, createdAt: Timestamp.fromDate(new Date()) }
  await addDoc(collection(db, 'clients'), clientToAdd)
  showForm.value = false
}

async function deleteClient(client) {
  if (confirm(`確定要刪除客戶「${client.name}」嗎？\n所有相關的維修紀錄將會被一併永久刪除！`)) {
    try {
      const recordsQuery = query(
        collection(db, 'maintenanceRecords'),
        where('vin', '==', client.vin),
      )
      const recordsSnapshot = await getDocs(recordsQuery)
      const batch = writeBatch(db)
      recordsSnapshot.forEach((doc) => {
        batch.delete(doc.ref)
      })
      const clientDocRef = doc(db, 'clients', client.id)
      batch.delete(clientDocRef)
      await batch.commit()
    } catch (error) {
      console.error('Error deleting client and records: ', error)
      alert('刪除失敗，請稍後再試。')
    }
  }
}

async function updateClient() {
  if (!editingClient.value) return
  // Note: Validation for edit form is not yet implemented
  const clientDocRef = doc(db, 'clients', editingClient.value.id)
  const { id, ...dataToUpdate } = editingClient.value
  await updateDoc(clientDocRef, dataToUpdate)
  editingClient.value = null
}

async function addRecord() {
  if (!newRecord.value.item) {
    alert('維修項目為必填欄位！')
    return
  }
  const recordToAdd = {
    ...newRecord.value,
    vin: viewingClientRecords.value.vin,
    price: Number(newRecord.value.price) || 0,
  }
  await addDoc(collection(db, 'maintenanceRecords'), recordToAdd)
  newRecord.value = { date: new Date().toISOString().split('T')[0], item: '', price: 0 }
  showAddRecordForm.value = false
}

async function deleteRecord(id) {
  if (confirm('確定要刪除這筆維修紀錄嗎？')) {
    await deleteDoc(doc(db, 'maintenanceRecords', id))
  }
}

async function updateRecord() {
  if (!editingRecord.value) return
  const recordDocRef = doc(db, 'maintenanceRecords', editingRecord.value.id)
  const { id, ...dataToUpdate } = editingRecord.value
  await updateDoc(recordDocRef, { ...dataToUpdate, price: Number(dataToUpdate.price) || 0 })
  editingRecord.value = null
}
</script>

<template lang="pug">
#app-container
  .loading-overlay(v-if="isLoading")
    .spinner
  template(v-else)
    header.app-header
      h1 琥王電動車 - 客戶資料
    main
      .toolbar
        button.btn.btn-primary(@click="openAddClientForm") 新增客戶
        input.search-input(type="text", v-model="searchQuery", placeholder="查詢姓名、電話、車牌或車身號碼")

      //- Forms
      form.data-form(v-if="showForm", @submit.prevent="addClient")
        h3 新增客戶資料
        .form-grid
          .form-group
            input(type="text", v-model="newClient.name", placeholder="姓名", @blur="v$.name.$touch", :class="{ 'input-error': v$.name.$error }")
            .form-error(v-if="v$.name.$error") {{ v$.name.$errors[0].$message }}
          .form-group
            input(type="tel", v-model="newClient.phone", placeholder="電話", @blur="v$.phone.$touch", :class="{ 'input-error': v$.phone.$error }")
            .form-error(v-if="v$.phone.$error") {{ v$.phone.$errors[0].$message }}
          .form-group
            input(type="text", v-model="newClient.licensePlate", placeholder="車牌號碼")
          .form-group
            input(type="text", v-model="newClient.vin", placeholder="車身號碼")
        .form-group
          textarea(v-model="newClient.memo", placeholder="備註")
        .form-buttons
          button.btn.btn-primary(type="submit", :disabled="v$.$invalid") 儲存
          button.btn(type="button", @click="showForm = false") 取消

      form.data-form(v-if="editingClient", @submit.prevent="updateClient")
        h3 編輯客戶資料
        .form-grid
          input(type="text", v-model="editingClient.name", placeholder="姓名", required)
          input(type="tel", v-model="editingClient.phone", placeholder="電話")
          input(type="text", v-model="editingClient.licensePlate", placeholder="車牌號碼")
          input(type="text", v-model="editingClient.vin", placeholder="車身號碼", readonly)
        .form-group
          textarea(v-model="editingClient.memo", placeholder="備註")
        .form-buttons
          button.btn.btn-primary(type="submit") 更新
          button.btn(type="button", @click="cancelEdit") 取消

      //- Clients Table
      .table-container
        table
          thead
            tr
              th.sortable(@click="sortBy('name')")
                | 姓名
                span(v-if="sortKey === 'name'") {{ sortOrder === 'asc' ? '▲' : '▼' }}
              th.sortable(@click="sortBy('phone')")
                | 電話
                span(v-if="sortKey === 'phone'") {{ sortOrder === 'asc' ? '▲' : '▼' }}
              th.sortable(@click="sortBy('licensePlate')")
                | 車牌號碼
                span(v-if="sortKey === 'licensePlate'") {{ sortOrder === 'asc' ? '▲' : '▼' }}
              th.sortable(@click="sortBy('vin')")
                | 車身號碼
                span(v-if="sortKey === 'vin'") {{ sortOrder === 'asc' ? '▲' : '▼' }}
              th.sortable(@click="sortBy('createdAt')")
                | 建立時間
                span(v-if="sortKey === 'createdAt'") {{ sortOrder === 'asc' ? '▲' : '▼' }}
              th 備註
              th 最新維修紀錄
              th 操作
          tbody
            tr(v-for="client in paginatedClients", :key="client.id")
              td(data-label="姓名") {{ client.name }}
              td(data-label="電話") {{ client.phone }}
              td(data-label="車牌號碼") {{ client.licensePlate }}
              td(data-label="車身號碼") {{ client.vin }}
              td(data-label="建立時間") {{ formatTimestamp(client.createdAt) }}
              td(data-label="備註") {{ truncateText(client.memo) }}
              td(data-label="最新維修紀錄")
                ul.record-list
                  li(v-for="record in getLatestRecords(client.vin)", :key="record.id") {{ record.date }}: {{ record.item }} (NT${{ record.price }})
                  li.no-record(v-if="getLatestRecords(client.vin).length === 0") 無維修紀錄
                button.link-button(@click="showAllRecords(client)") 查看更多
              td(data-label="操作")
                .action-buttons
                  button.btn.btn-secondary(@click="startEdit(client)") 編輯
                  button.btn.btn-danger(@click="deleteClient(client)") 刪除
            tr(v-if="!isLoading && filteredClients.length === 0")
              td.no-results(colspan="8") 找不到符合的客戶資料。

      //- Pagination Controls
      .pagination-controls(v-if="!isLoading && totalPages > 1")
        select(v-model="pageSize")
          option(v-for="size in pageSizes", :key="size", :value="size") 每頁 {{ size }} 筆
        span 共 {{ filteredClients.length }} 筆資料，第 {{ currentPage }} / {{ totalPages }} 頁
        div
          button.btn(@click="goToPage(1)", :disabled="currentPage === 1") «
          button.btn(@click="goToPage(currentPage - 1)", :disabled="currentPage === 1") ‹
          button.btn(@click="goToPage(currentPage + 1)", :disabled="totalPages === 0 || currentPage === totalPages") ›
          button.btn(@click="goToPage(totalPages)", :disabled="totalPages === 0 || currentPage === totalPages") »

      //- Modals
      .modal-overlay(v-if="viewingClientRecords", @click.self="closeRecordModal")
        .modal-content
          header.modal-header
            h3 {{ viewingClientRecords.name }} 的維修紀錄
            button.close-button(@click="closeRecordModal") &times;
          .modal-body
            button.btn.btn-primary.btn-full-width(v-if="!showAddRecordForm", @click="showAddRecordForm = true") 新增維修紀錄
            form.record-form(v-if="showAddRecordForm", @submit.prevent="addRecord")
              input(type="date", v-model="newRecord.date", required)
              input(type="text", v-model="newRecord.item", placeholder="維修項目", required)
              input(type="number", v-model="newRecord.price", placeholder="價格")
              div
                button.btn.btn-primary(type="submit") 儲存紀錄
                button.btn(type="button", @click="showAddRecordForm = false") 取消
            ul.record-list-modal
              li(v-for="record in allRecordsForViewingClient", :key="record.id")
                div(v-if="editingRecord && editingRecord.id === record.id")
                  form.record-form-inline(@submit.prevent="updateRecord")
                    input(type="date", v-model="editingRecord.date", required)
                    input(type="text", v-model="editingRecord.item", required)
                    input(type="number", v-model="editingRecord.price")
                    button.btn.btn-primary(type="submit") 更新
                    button.btn(type="button", @click="cancelEditRecord") 取消
                .record-item(v-else)
                  span
                    strong {{ record.date }}
                    | : {{ record.item }} -
                    em NT${{ record.price }}
                  div
                    button.link-button(@click="startEditRecord(record)") 編輯
                    button.link-button-danger(@click="deleteRecord(record.id)") 刪除
              li.no-record(v-if="allRecordsForViewingClient.length === 0 && !showAddRecordForm") 無維修紀錄

</template>

<style>
/* Global Styles & Font Import */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
:root {
  --primary-color: #007bff;
  --primary-hover: #0056b3;
  --secondary-color: #6c757d;
  --secondary-hover: #5a6268;
  --danger-color: #dc3545;
  --danger-hover: #c82333;
  --light-gray: #f8f9fa;
  --gray: #dee2e6;
  --dark-gray: #343a40;
  --text-color: #212529;
  --border-radius: 0.375rem;
  --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
body {
  font-family: 'Inter', sans-serif;
  background-color: var(--light-gray);
  color: var(--text-color);
  margin: 0;
  padding: 2rem;
}
#app-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem;
  background-color: white;
  border-radius: var(--border-radius);
  box-shadow: var(--shadow);
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 200;
}

.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border-left-color: var(--primary-color);
  animation: spin 1s ease infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.app-header {
  text-align: center;
  margin-bottom: 2rem;
}
.app-header h1 {
  color: var(--dark-gray);
}
.toolbar {
  margin-bottom: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}
.data-form {
  border: 1px solid var(--gray);
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  border-radius: var(--border-radius);
  background-color: #fff;
}
.data-form h3 {
  margin-top: 0;
  margin-bottom: 1.5rem;
}
.form-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex-grow: 1;
}
.form-group textarea {
  width: 100%;
  min-height: 80px;
}
.form-buttons {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1.5rem;
}
.search-input,
input[type='text'],
input[type='tel'],
input[type='number'],
input[type='date'],
textarea {
  padding: 0.6rem 0.8rem;
  border: 1px solid #e0e0e0;
  border-radius: var(--border-radius);
  font-size: 1rem;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  font-family: inherit;
}
.search-input {
  width: 450px;
}
.search-input:focus,
input:focus,
textarea:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25);
  outline: none;
}
input.input-error,
textarea.input-error {
  border-color: var(--danger-color);
}
input[readonly] {
  background-color: var(--light-gray);
}
.form-error {
  color: var(--danger-color);
  font-size: 0.875rem;
  height: 1rem;
}
.btn {
  padding: 0.75rem 1.25rem;
  border: none;
  border-radius: var(--border-radius);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.2s,
    transform 0.1s;
}
.btn:disabled { 
  background-color: var(--secondary-color);
  cursor: not-allowed;
  opacity: 0.65;
}
.btn:active { transform: scale(0.98); }
.btn-primary { background-color: var(--primary-color); color: white; }
.btn-primary:hover:not(:disabled) { background-color: var(--primary-hover); }
.btn-secondary { background-color: var(--secondary-color); color: white; }
.btn-secondary:hover { background-color: var(--secondary-hover); }
.btn-danger { background-color: var(--danger-color); color: white; }
.btn-danger:hover { background-color: var(--danger-hover); }
.link-button { background: none; border: none; color: var(--primary-color); text-decoration: underline; cursor: pointer; padding: 0; }
.link-button-danger { background: none; border: none; color: var(--danger-color); text-decoration: underline; cursor: pointer; padding: 0; margin-left: 0.5rem; }
.table-container { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
thead { background-color: var(--light-gray); }
th,
td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid var(--gray);
}
th { font-weight: 600; }
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { background-color: #e9ecef; }
	body tr:hover { background-color: #f1f3f5; }
.action-buttons { display: flex; gap: 0.5rem; }
.no-results,
.no-record { text-align: center; color: var(--secondary-color); padding: 2rem; }
.pagination-controls { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 0; flex-wrap: wrap; gap: 1rem; }
.pagination-controls select { padding: 0.5rem; border-radius: var(--border-radius); border: 1px solid #e0e0e0; }
.pagination-controls div { display: flex; gap: 0.5rem; }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.6); display: flex; justify-content: center; align-items: center; z-index: 100; }
.modal-content { background-color: white; padding: 0; border-radius: var(--border-radius); min-width: 600px; max-width: 90%; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2); display: flex; flex-direction: column; }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem; border-bottom: 1px solid var(--gray); }
.modal-header h3 { margin: 0; }
.close-button { background: none; border: none; font-size: 2rem; cursor: pointer; color: var(--secondary-color); }
.modal-body { padding: 1.5rem; max-height: 60vh; overflow-y: auto; }
.record-list-modal li { display: flex; flex-direction: column; padding: 1rem 0; border-bottom: 1px solid #f1f3f5; }
.record-item { display: flex; justify-content: space-between; align-items: center; }
.record-form,
.record-form-inline { border: 1px solid var(--gray); padding: 1rem; margin-top: 1rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.btn-full-width { width: 100%; margin-bottom: 1rem; }
</style>