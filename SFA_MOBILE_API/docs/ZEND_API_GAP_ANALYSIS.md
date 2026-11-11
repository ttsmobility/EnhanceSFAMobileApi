# Zend API Gap Analysis

**Comparison date:** 2026-11-11  
**Updated module:** `application/modules/api/api`  
**Baseline module:** `application/modules/without_route_tracking_old_api`

## Executive Summary

The active-file comparison found only two controllers with behavioral changes:

1. `controllers/IndexController.php`
2. `controllers/SyncController.php`

All other matched active controllers, bootstrap, library, model, and view files are byte-identical. The updated folder also contains six historical `ImportController` copies that are not present in the baseline active layout.

The important business change is new customer visit/route activity data:

- `collectiononly` for `customeroperationscontrol`
- `cft`, `autocheckout`, `onpremisevisit`, and `holdorder` for `customervisitlog`
- `cft` for `routesequencecustomerstatus`

The updated Zend calls match the procedure signatures in `database_structure/sfa_enhance_live_struct.sql`. They do not match the older signatures in `database_structure/sfa_migration_table_structure.sql`. The Node API currently does not persist these new fields.

## Updated Live Schema Review

`database_structure/sfa_enhance_live_struct.sql` is an untracked full schema export, so Git cannot show its history. It was compared with `database_structure/sfa_migration_table_structure.sql` as the available baseline.

### Object inventory

| Object | Migration baseline | Updated live schema | Difference |
| --- | ---: | ---: | ---: |
| Tables | 473 | 454 | -19 |
| Stored procedures | 1,388 | 1,402 | +14 |

The lower live table count mainly comes from old archive, test, spreadsheet-import, and route-specific temporary tables being absent. This does not by itself indicate missing production functionality.

### New business tables

| Table | Purpose inferred from schema |
| --- | --- |
| `clustermaster` | Defines customer clusters and active status |
| `customerclustermapping` | Maps channel and division to CFT values |

### New business procedures

The live schema adds cluster management, company/entity lookup, route status, and daily-summary procedures:

- `sp_add_basic_index_addcluster`
- `sp_delete_account_customer_customercluster`
- `sp_delete_basic_index_cluster`
- `sp_edit_basic_index_addcluster`
- `sp_get_account_customer_addcustomercluster`
- `sp_get_account_customer_customercluster`
- `sp_get_basic_index_addcluster`
- `sp_get_basic_index_cluster`
- `sp_get_distinct_company_entity`
- `sp_save_account_customer_addcustomercluster`
- `sp_daily_summary`
- `sp_salesman_route_status`
- `sp_ws_syncicsdata_customers_new`
- `sp_ws_syncicsdata_customers_old`

These are additional business capabilities. They are not all necessarily mobile endpoints, so usage must be confirmed before adding Node equivalents.

### Added API-relevant columns

#### `customermaster`

- `customerfacetime`
- `toplpo`
- `enableautocheckout`
- `autocheckoutradius`
- `nonjpsales`
- `nonjporder`
- `nonjpreturns`
- `nonjpcollections`
- `channel`

The Node customer sync now returns the complete updated Zend response set: derived `customerfacetime`, auto-checkout settings, non-JP flags, and `toplpo`. The `channel` column is used internally with `divisioncode` to obtain fallback CFT from `customerclustermapping`; Zend does not return `channel` as a separate response field.

#### `routemaster`

- `directcollection`
- `enableautocheckout`
- `autocheckoutaccuracy`
- `starttime`
- `endtime`
- `shownojpcustomer`

The Node `RouteMaster` query does not currently return these six fields.

#### Transaction activity tables

- `customeroperationscontrol.collectiononly`
- `customervisitlog.cft`
- `customervisitlog.autocheckout`
- `customervisitlog.onpremisevisit`
- `customervisitlog.holdorder`
- `routesequencecustomerstatus.cft`

These six columns directly correspond to the updated `SyncController.php` procedure parameters.

#### Other additions

- `company.clustercode`
- `company.entity`
- `temp_divisionmaster.LEDGER_NAME`

The remaining common-table definition differences are mainly collation/default changes on reporting temporary tables and are not part of the current mobile API contract.

## File Comparison

### Behaviorally changed files

| Updated file | Baseline file | Result |
| --- | --- | --- |
| `api/api/controllers/IndexController.php` | `without_route_tracking_old_api/controllers/mobileApi/IndexController.php` | Changed |
| `api/api/controllers/SyncController.php` | `without_route_tracking_old_api/controllers/mobileApi/SyncController.php` | Changed |

### Matched files with no content change

- `Bootstrap.php`
- `controllers/CustomerController.php`
- `controllers/ImageController.php`
- `controllers/TransactionController.php`
- `controllers/WsController.php`
- `controllers/CronController.php`
- `controllers/ErrorController.php`
- `controllers/ExportController.php`
- `controllers/ImportController.php`
- `controllers/IndextestController.php`
- `controllers/service.php`
- `library/Controller/Action/Abstract.php`
- `models/Entities/Test.php`
- `models/Repositories/Tests.php`
- `views/scripts/error/error.phtml`
- `views/scripts/index/home.phtml`

### Extra historical files in the updated folder

- `ImportController -bk02012016.php`
- `ImportController112233.php`
- `ImportController_.php`
- `ImportController_03-10-2017.php`
- `ImportController_21-09-2017.php`
- `ImportController_30-12-2017.php`

Each extra file declares the same `Api_ImportController` class. They appear to be backups rather than active controllers. Keeping duplicate controller classes inside the deployed module increases maintenance and accidental-loading risk.

## IndexController Changes

### `getsyncdataAction()` restored

The updated controller adds `getsyncdataAction()` before the existing `getsyncdata1Action()`.

Newly available legacy endpoint:

```text
/api/index/getsyncdata/userid/:userid/deviceid/:deviceid/routeid/:routeid/mdate/:mdate/table/:table
```

It performs table-group synchronization through the same stored-procedure families used by the legacy sync implementation.

### Gap and risk

- The baseline has only `getsyncdata1Action()`.
- The PhoneGap analysis previously identified `getsyncdata1` as the active mobile synchronization endpoint.
- Reintroducing `getsyncdata` creates two similar sync endpoints and can cause maintenance confusion.
- No current Node parity work is required unless another client is confirmed to call `getsyncdata`.
- Do not remove the restored endpoint until server access logs and all client versions confirm it is unused.

## SyncController Changes

### 1. Customer operation control

Updated behavior:

```php
$param_array[20] = collectiononly or 0;
CALL sp_ws_getdata_from_customeroperationcontrol(...20 parameters...)
```

Database effect:

```text
customeroperationscontrol.collectiononly
```

Compatibility:

- `sfa_enhance_live_struct.sql`: accepts 20 parameters and stores `collectiononly`.
- `sfa_migration_table_structure.sql`: accepts only 19 parameters.
- Running the updated PHP against the older procedure will fail with an incorrect parameter-count error.

Node gap:

`saveCustomerOperationControl()` currently stores fields only through `log_id`; it does not store `collectiononly`.

### 2. Customer visit log

Updated behavior adds four parameters:

```text
cft
autocheckout
onpremisevisit
holdorder
```

The procedure call changes from 9 to 13 parameters.

Database effect:

```text
customervisitlog.cft
customervisitlog.autocheckout
customervisitlog.onpremisevisit
customervisitlog.holdorder
```

Compatibility:

- `sfa_enhance_live_struct.sql`: accepts all 13 parameters and inserts/updates the four fields.
- `sfa_migration_table_structure.sql`: accepts only the original 9 parameters.
- `autocheckout` is read without an `isset`/null fallback in PHP. Missing payload data can generate an undefined-index notice, although casting commonly produces `0` under the current PHP behavior.

Node gap:

`saveCustomerVisitLog()` currently inserts and updates only the original visit fields and `mdate`. The four new values are ignored.

### 3. Route sequence customer status

Updated behavior adds `cft` as parameter 10 in both upload paths:

- Main `senddata` processing
- `invtxndetailAction()` processing

Database effect:

```text
routesequencecustomerstatus.cft
```

Compatibility:

- `sfa_enhance_live_struct.sql`: accepts parameter 10 and stores `cft` on insert/update.
- `sfa_migration_table_structure.sql`: accepts only 9 parameters.

Node gap:

`saveCustomerSequence()` does not insert or update `cft`.

## Defect Found

### Incorrect source variable in `invtxndetailAction()`

Inside `foreach ($json as $j)`, the updated code reads:

```php
$param_array[10] = (int) ($params[$i]['cft'] ?? 0);
```

However, `$params` is the original JSON string and `$i` remains `0`. The current record is `$j`.

Expected source:

```php
$param_array[10] = (int) ($j['cft'] ?? 0);
```

Impact: the dedicated invoice transaction detail path will normally send `cft = 0`, even when the uploaded record contains a nonzero value.

Severity: **High for CFT reporting accuracy; low for endpoint availability.**

## Node API Parity Gaps

| Business data | Updated Zend | Current Node | Gap |
| --- | --- | --- | --- |
| `customeroperationscontrol.collectiononly` | Stored | Not stored | Open |
| `customervisitlog.cft` | Stored | Not stored | Open |
| `customervisitlog.autocheckout` | Stored | Not stored | Open |
| `customervisitlog.onpremisevisit` | Stored | Not stored | Open |
| `customervisitlog.holdorder` | Stored | Not stored | Open |
| `routesequencecustomerstatus.cft` | Stored | Not stored | Open |
| Customer `customerfacetime`, `toplpo`, and auto-checkout settings | Returned by updated live customer sync procedures | Returned by Node with Zend-compatible defaults and CFT fallback | Implemented |
| Customer non-JP flags | Returned by updated live customer sync procedures | Returned by Node with `0` defaults | Implemented |
| Customer `channel` | Used internally to resolve cluster CFT | Used internally; not exposed as a separate response field | Implemented |
| Route direct-collection and auto-checkout settings | Returned by updated live setting procedure | Not returned by Node | Open |
| Route working times and non-JP visibility | Returned by updated live setting procedure | Not returned by Node | Open |
| `/api/index/getsyncdata` | Restored | Compatibility depends on registered Node aliases | Verify usage before changing |

These gaps are in `SFA_MOBILE_API/src/modules/mobile/transactions/models/routeActivity.model.ts`.

## Recommended Action Order

1. Correct the Zend `invtxndetailAction()` variable from `$params[$i]` to `$j`.
2. Confirm the production database uses the live 20/13/10-parameter procedure versions before deploying the updated Zend controller.
3. Add the six new persistence fields to the Node transaction model while preserving default `0` behavior for older mobile payloads.
4. Add the new route setting columns to Node master sync after confirming the deployed mobile SQLite schema expects them. CustomerMaster parity is complete.
5. Compare Zend and Node master-sync array keys and upload acknowledgements after adding the fields; existing response keys must remain unchanged.
6. Test customer visit, collection-only visit, auto-checkout, on-premise visit, held order, route sequence upload, and `invtxndetail` upload.
7. Review server access logs before deciding whether the restored `getsyncdata` endpoint is required.
8. Move historical `ImportController` copies outside the deployable controller directory after team approval.

## Overall Assessment

The Zend update is small but relies on a broader live-schema feature set that is not yet fully represented in the Node API. The updated Zend is compatible with `sfa_enhance_live_struct.sql`, not with the older migration procedure definitions. CustomerMaster download parity is complete; RouteMaster download fields and transaction-upload fields remain open. One new PHP line in `invtxndetailAction()` is likely incorrect and should be fixed before relying on CFT data from that endpoint.
