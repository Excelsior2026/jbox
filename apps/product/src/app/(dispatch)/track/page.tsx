'use client';

import { useState } from 'react';

const STEPS = [
  'Request Received',
  'Estimate Dispatched',
  'Work Approved',
  'Tech En Route',
  'Job Completed & Paid',
] as const;

export default function DispatchTrackPage() {
  const [activeStep] = useState(0);

  return (
    <section className="dispatch-tracker">
      <h1>Live Job Status</h1>

      <div className="dispatch-tracker-form">
        <input
          type="text"
          placeholder="Enter job ticket number..."
          aria-label="Job ticket number"
        />
        <button type="button" className="dispatch-btn dispatch-btn-primary">
          Look Up
        </button>
      </div>

      <div className="dispatch-stepper">
        {STEPS.map((step, i) => {
          const isCompleted = i < activeStep;
          const isActive = i === activeStep;
          const isLast = i === STEPS.length - 1;

          return (
            <div className="dispatch-step" key={step}>
              <div className="dispatch-step-indicator">
                <div
                  className={`dispatch-step-dot${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`}
                />
                {!isLast && (
                  <div
                    className={`dispatch-step-line${isCompleted ? ' completed' : ''}`}
                  />
                )}
              </div>
              <div className="dispatch-step-content">
                <div
                  className={`dispatch-step-label${isCompleted ? ' completed' : ''}${isActive ? ' active' : ''}`}
                >
                  {step}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
