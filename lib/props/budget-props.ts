import { aws_budgets as budgets } from 'aws-cdk-lib'

interface BudgetProp {
    budgetName: string;
    usdLimitAmount: number;
    notifications: Array<budgets.CfnBudget.NotificationProperty>;
}

export const budgetProps: BudgetProp[] = [
  {
    budgetName: 'free',
    usdLimitAmount: 1.0,
    notifications: [
      {
        comparisonOperator: 'GREATER_THAN',
        notificationType: 'ACTUAL',
        threshold: 0,
        thresholdType: 'ABSOLUTE_VALUE'
      }
    ]
  },
  {
    budgetName: 'cost',
    usdLimitAmount: 7.0,
    notifications: [
      {
        comparisonOperator: 'GREATER_THAN',
        notificationType: 'ACTUAL',
        threshold: 85,
        thresholdType: 'PERCENTAGE'
      },
      {
        comparisonOperator: 'GREATER_THAN',
        notificationType: 'ACTUAL',
        threshold: 100,
        thresholdType: 'PERCENTAGE'
      },
      {
        comparisonOperator: 'GREATER_THAN',
        notificationType: 'FORECASTED',
        threshold: 100,
        thresholdType: 'PERCENTAGE'
      }
    ]
  }
]
