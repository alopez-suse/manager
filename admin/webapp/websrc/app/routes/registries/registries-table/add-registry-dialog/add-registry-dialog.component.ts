import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { RegistriesTableComponent } from '../registries-table.component';
import { FormGroup } from '@angular/forms';
import { AddRegistryFieldConfig } from './add-registry-form-configs';
import { cloneDeep } from 'lodash';
import { INTERVAL_STEP_VALUES } from './add-registry-form-configs/constants/constants';
import {
  AWSKey,
  ErrorResponse,
  GCRKey,
  RegistryConfig,
  RegistryPostBody,
  ScanSchedule,
} from '@common/types';
import { RegistriesService } from '@services/registries.service';
import { finalize, take } from 'rxjs/operators';
import { TestSettingsDialogComponent } from './test-connection-dialog/test-settings-dialog.component';
import { RegistriesCommunicationService } from '../../regestries-communication.service';
import { GlobalConstant } from '@common/constants/global.constant';
import { NotificationService } from '@services/notification.service';
import { FormlyFieldConfig, FormlyFormOptions } from '@ngx-formly/core';
import { GlobalVariable } from '@common/variables/global.variable';
import { MapConstant } from '@common/constants/map.constant';

@Component({
  selector: 'app-add-registry-dialog',
  templateUrl: './add-registry-dialog.component.html',
  styleUrls: ['./add-registry-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddRegistryDialogComponent implements OnInit, AfterViewChecked {
  maskFieldWhenEdit = '********';
  form = new FormGroup({});
  model: any = {};
  fields = cloneDeep(AddRegistryFieldConfig);
  options: FormlyFormOptions = {
    formState: {
      isFedAdmin:
        GlobalVariable.user.token.role === MapConstant.FED_ROLES.FEDADMIN,
      isMaster: GlobalVariable.isMaster,
    },
  };
  submittingForm = false;
  canTestConnectionTypes = ['Docker Registry', 'JFrog Artifactory'];
  canTestConnection!: boolean;
  saving$ = this.registriesCommunicationService.saving$;

  constructor(
    private dialog: MatDialog,
    public dialogRef: MatDialogRef<RegistriesTableComponent>,
    @Inject(MAT_DIALOG_DATA)
    public data: { isEdit: boolean; editable: boolean; config: RegistryConfig },
    private registriesService: RegistriesService,
    private registriesCommunicationService: RegistriesCommunicationService,
    private notificationService: NotificationService
  ) {}

  submit(): void {
    if (this.form.valid) {
      this.registriesCommunicationService.initSave();
      let body!: RegistryPostBody;
      const schedule: ScanSchedule = { schedule: 'manual', interval: 0 };
      let gcr_key: GCRKey | undefined;
      const {
        auto_scan,
        periodic_scan,
        interval,
        aws_key,
        json_key,
        ...formValue
      } = this.form.value;
      if (formValue.isFed) {
        formValue.name = 'fed.' + formValue.name;
      }
      if (periodic_scan) {
        schedule.schedule = 'periodical';
        schedule.interval = INTERVAL_STEP_VALUES[interval].value;
      }
      if (auto_scan) {
        schedule.schedule = 'auto';
        schedule.interval = 300;
      }
      if (aws_key && Object.keys(aws_key).length > 0) {
        body = {
          config: { ...formValue, schedule, aws_key },
        };
      } else if (json_key) {
        gcr_key = {
          json_key,
        };
        body = {
          config: { ...formValue, schedule, gcr_key },
        };
      } else {
        body = {
          config: { ...formValue, schedule },
        };
      }
      if (!body.config.auth_with_token) {
        body.config.auth_with_token = false;
      }
      body.config.cfg_type = this.model.isFed
        ? GlobalConstant.CFG_TYPE.FED
        : GlobalConstant.CFG_TYPE.CUSTOMER;
      this.submittingForm = true;
      if (this.model?.isEdit) {
        body.config.password =
          body.config.password !== this.maskFieldWhenEdit
            ? body.config.password
            : undefined;
        body.config.registry_type = this.model.registry_type;
        body.config.name = this.model.name;
        this.registriesService
          .patchRegistry({ wrap: body, name: body.config.name })
          .pipe(
            take(1),
            finalize(() => {
              this.submittingForm = false;
            })
          )
          .subscribe({
            complete: () => {
              this.registriesCommunicationService.refreshRegistries(1000);
              this.saving$.subscribe(saving => {
                if (!saving) {
                  this.dialogRef.close(true);
                }
              });
            },
            error: ({ error }: { error: ErrorResponse }) => {
              this.registriesCommunicationService.cancelSave();
              this.notificationService.open(
                error.message,
                GlobalConstant.NOTIFICATION_TYPE.ERROR
              );
            },
          });
      } else {
        this.registriesService
          .postRegistry(body)
          .pipe(
            finalize(() => {
              this.submittingForm = false;
            })
          )
          .subscribe({
            complete: () => {
              this.registriesCommunicationService.refreshRegistries(1000);
              this.saving$.subscribe(saving => {
                if (!saving) {
                  this.dialogRef.close(true);
                }
              });
            },
            error: ({ error }: { error: ErrorResponse }) => {
              this.registriesCommunicationService.cancelSave();
              this.notificationService.open(
                error.message,
                GlobalConstant.NOTIFICATION_TYPE.ERROR
              );
            },
          });
      }
    }
  }

  ngOnInit(): void {
    if (this.data.config) {
      const { schedule, ...data } = this.data.config;
      const interval =
        Object.keys(INTERVAL_STEP_VALUES).find(
          key => INTERVAL_STEP_VALUES[key].value === schedule.interval
        ) || 0;
      let periodic_scan = false;
      let auto_scan = false;
      switch (schedule.schedule) {
        case 'auto': {
          auto_scan = true;
          break;
        }
        case 'periodical': {
          periodic_scan = true;
          break;
        }
      }
      this.model = {
        ...data,
        isEdit: this.data.isEdit,
        isRemote: GlobalVariable.isRemote,
        isFed: data.cfg_type === GlobalConstant.CFG_TYPE.FED,
        password: this.maskFieldWhenEdit,
        auto_scan,
        periodic_scan,
        interval,
      };
    } else {
      this.model = {
        isEdit: this.data.isEdit,
        isRemote: GlobalVariable.isRemote,
      };
    }
    if (!this.data.editable) {
      this.disableFields(this.fields);
    }
  }

  disableFields(fields: FormlyFieldConfig[]): void {
    fields.forEach(field => {
      field.expressionProperties = {
        'templateOptions.disabled': () => true,
      };
      if (field.fieldGroup) {
        this.disableFields(field.fieldGroup);
      }
    });
  }

  ngAfterViewChecked(): void {
    this.canTestConnection =
      this.data.editable &&
      this.canTestConnectionTypes.includes(
        this.form.controls?.registry_type?.value
      );
  }

  onNoClick(): void {
    this.dialogRef.close(false);
  }

  openTestConnectionDialog(): void {
    const dialog = this.dialog.open(TestSettingsDialogComponent, {
      width: '80%',
      maxWidth: '1100px',
      data: {
        ...this.model,
        schedule: this.getSchedule(this.model),
        password:
          this.model.password !== this.maskFieldWhenEdit
            ? this.model.password
            : undefined,
      },
    });

    dialog.afterClosed().subscribe((filters: string[]) => {
      if (filters.length) {
        this.form.controls.filters.setValue(filters);
      }
    });
  }

  private getSchedule(model: any): ScanSchedule {
    const schedule: ScanSchedule = { schedule: 'manual', interval: 0 };
    if (model.periodic_scan) {
      schedule.schedule = 'periodical';
      schedule.interval = INTERVAL_STEP_VALUES[model.interval].value;
    }
    if (model.auto_scan) {
      schedule.schedule = 'auto';
      schedule.interval = 300;
    }
    return schedule;
  }
}
