type MarkedAnswer = {
  marksObtained: number | null;
};

export function sumMarksObtained<T extends MarkedAnswer>(answers: T[]): number {
  return answers.reduce((total, answer) => {
    if (typeof answer.marksObtained !== 'number' || Number.isNaN(answer.marksObtained)) {
      return total;
    }

    return total + answer.marksObtained;
  }, 0);
}
